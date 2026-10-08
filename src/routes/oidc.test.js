const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const { Database } = require("bun:sqlite");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { authorizationCode, pkceChallenge } = require("../test-support/fake-idp.cjs");
const { responseCookies, startServer } = require("../test-support/server.cjs");

const secret = "isolated-oidc-test-secret";
const PROVIDER = {
	JWT_SECRET_KEY: secret,
	OIDC_ENABLED: "true",
	OIDC_ISSUER_URL: "https://idp.test",
	OIDC_CLIENT_ID: "reddont",
	OIDC_CLIENT_SECRET: "client-secret",
	OIDC_REDIRECT_URI: "https://reddont.test/auth/oidc/callback",
	OIDC_ALLOWED_GROUPS: "readers",
};
const realFetch = globalThis.fetch;
let server;
let restricted;
let db;

beforeAll(async () => {
	[server, restricted] = await Promise.all([
		startServer("oidc-server.cjs", "oidc-test", PROVIDER),
		startServer("oidc-server.cjs", "oidc-test", { ...PROVIDER, OIDC_AUTO_REGISTER: "false" }),
	]);
	db = new Database(path.join(server.dataDir, "reddont.db"));
}, 15000);

afterAll(async () => {
	db?.close();
	await Promise.all([server?.stop(), restricted?.stop()]);
});

function get(target, route, cookie) {
	return realFetch(target.baseUrl + route, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
}

function loginMessage(response) {
	expect(response.status).toBe(302);
	const location = new URL(response.headers.get("location"), "http://reddont.test");
	expect(location.pathname).toBe("/login");
	expect(location.searchParams.get("bypass_oidc")).toBe("true");
	return location.searchParams.get("message");
}

// Starts a sign-in, lets the provider answer with `answer`, and returns the
// callback response. `forge` alters the callback the browser presents.
async function signIn(target, answer, { redirect = "/", forge = {} } = {}) {
	const start = await get(target, `/auth/oidc/login?redirect=${encodeURIComponent(redirect)}`);
	const authorize = new URL(start.headers.get("location"));
	const code = authorizationCode({
		nonce: authorize.searchParams.get("nonce"),
		codeChallenge: forge.codeChallenge || authorize.searchParams.get("code_challenge"),
		...answer,
	});
	const query = new URLSearchParams({ code, state: forge.state || authorize.searchParams.get("state") });
	const cookies = Object.entries(responseCookies(start)).map(([name, { value }]) => `${name}=${value}`);
	return get(target, `/auth/oidc/callback?${query}`, forge.cookies ?? cookies.join("; "));
}

function sessionCookie(response) {
	return `auth_token=${responseCookies(response).auth_token.value}`;
}

function account(sub) {
	return db
		.query("SELECT id, username, isAdmin, groups, oidc_refresh_token, oidc_token_expires_at FROM users WHERE oidc_sub = ?")
		.get(sub);
}

describe("single sign-on login", () => {
	test("sends readers to the provider with PKCE and short-lived cookies", async () => {
		const login = await get(server, `/login?redirect=${encodeURIComponent("/r/test?sort=new")}`);
		expect(login.status).toBe(302);
		expect(login.headers.get("location")).toBe("/auth/oidc/login?redirect=%2Fr%2Ftest%3Fsort%3Dnew");

		const start = await get(server, login.headers.get("location"));
		const authorize = new URL(start.headers.get("location"));
		const cookies = responseCookies(start);
		expect(`${authorize.origin}${authorize.pathname}`).toBe("https://idp.test/authorize");
		for (const name of ["oidc_state", "oidc_nonce", "oidc_verifier", "oidc_redirect"]) {
			expect(cookies[name].attributes).toEqual(
				expect.arrayContaining(["max-age=600", "path=/auth/oidc", "httponly", "secure", "samesite=lax"]),
			);
		}
		expect(cookies.oidc_state.value).toBe(authorize.searchParams.get("state"));
		expect(cookies.oidc_nonce.value).toBe(authorize.searchParams.get("nonce"));
		expect(authorize.searchParams.get("code_challenge")).toBe(pkceChallenge(cookies.oidc_verifier.value));
		expect(decodeURIComponent(cookies.oidc_redirect.value)).toBe("/r/test?sort=new");
	});

	test("does not carry an off-site redirect through the provider", async () => {
		for (const redirect of ["//elsewhere.example/", "https://elsewhere.example/", "/\\elsewhere.example"]) {
			const start = await get(server, `/auth/oidc/login?redirect=${encodeURIComponent(redirect)}`);
			expect(decodeURIComponent(responseCookies(start).oidc_redirect.value)).toBe("/");
		}
	});

	test("makes the first account an admin and returns it to the requested page", async () => {
		const response = await signIn(
			server,
			{ claims: { sub: "sub-first", preferred_username: "first", groups: ["readers"] }, refreshToken: "rotate-1" },
			{ redirect: "/r/test?sort=new" },
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/r/test?sort=new");
		const cookies = responseCookies(response);
		for (const name of ["oidc_state", "oidc_nonce", "oidc_verifier", "oidc_redirect"]) {
			expect(cookies[name].value).toBe("");
			expect(cookies[name].attributes).toContain("path=/auth/oidc");
		}
		const user = account("sub-first");
		expect(user).toMatchObject({ username: "first", isAdmin: 1, groups: '["readers"]' });
		expect(user.oidc_refresh_token).not.toContain("rotate-1");
		expect(user.oidc_token_expires_at).toBeWithin(Date.now() / 1000 + 3500, Date.now() / 1000 + 3700);
		expect(jwt.verify(cookies.auth_token.value, secret)).toMatchObject({ id: user.id, username: "first" });

		const dashboard = await (await get(server, "/dashboard", sessionCookie(response))).text();
		expect(dashboard).toContain("<span>first</span>");
		expect(dashboard).toContain("<h2>invites</h2>");
	});

	test("gives later accounts admin rights only when their groups say so", async () => {
		await signIn(server, { claims: { sub: "sub-reader", email: "reader@example.com", groups: ["readers"] } });
		await signIn(server, { claims: { sub: "sub-boss", preferred_username: "boss", groups: ["readers", "admin"] } });

		expect(account("sub-reader")).toMatchObject({ username: "reader@example.com", isAdmin: 0 });
		expect(account("sub-boss")).toMatchObject({ username: "boss", isAdmin: 1, groups: '["readers","admin"]' });
	});

	test("turns away accounts outside the allowed groups", async () => {
		const response = await signIn(server, { claims: { sub: "sub-guest", preferred_username: "guest", groups: ["guests"] } });

		expect(loginMessage(response)).toBe("Not allowed (missing required group)");
		expect(responseCookies(response).auth_token).toBeUndefined();
		expect(account("sub-guest")).toBeNull();
	});

	test("links an existing password account with the same username", async () => {
		const { lastInsertRowid } = db.query("INSERT INTO users (username, password_hash) VALUES ('linked', 'x')").run();
		const response = await signIn(server, { claims: { sub: "sub-linked", preferred_username: "linked", groups: ["readers"] } });

		expect(account("sub-linked")).toMatchObject({ id: Number(lastInsertRowid), username: "linked", isAdmin: 0 });
		expect(jwt.verify(responseCookies(response).auth_token.value, secret).id).toBe(Number(lastInsertRowid));
	});

	test("updates a returning account's groups and refresh token", async () => {
		const before = account("sub-reader");
		await signIn(server, {
			claims: { sub: "sub-reader", email: "reader@example.com", groups: ["readers", "admin"] },
			refreshToken: "keep-1",
		});
		const updated = account("sub-reader");
		expect(updated).toMatchObject({ id: before.id, isAdmin: 1, groups: '["readers","admin"]' });
		expect(updated.oidc_refresh_token).not.toBeNull();

		await signIn(server, { claims: { sub: "sub-reader", email: "reader@example.com", groups: ["readers"] } });
		expect(account("sub-reader")).toMatchObject({ isAdmin: 0, oidc_refresh_token: updated.oidc_refresh_token });
	});

	test("sends failed callbacks back to the manual login form", async () => {
		const answer = { claims: { sub: "sub-first", preferred_username: "first", groups: ["readers"] } };

		expect(loginMessage(await signIn(server, answer, { forge: { cookies: "" } }))).toBe("OIDC session expired, try again");
		expect(loginMessage(await signIn(server, answer, { forge: { state: "forged" } }))).toBe("OIDC login failed");
		expect(loginMessage(await signIn(server, answer, { forge: { codeChallenge: "forged" } }))).toBe("OIDC login failed");
	});

	test("keeps manual login available", async () => {
		const response = await get(server, "/login?bypass_oidc=true&redirect=%2Fsubs");
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('action="/auth/oidc/login?redirect=%2Fsubs"');
		expect(html).toContain("back to SSO login");
		expect(html).toContain('action="/login?redirect=%2Fsubs" method="post"');
	});
});

describe("provider token refresh", () => {
	function expireSoon(sub) {
		db.query("UPDATE users SET oidc_token_expires_at = unixepoch() + 60 WHERE oidc_sub = ?").run(sub);
	}

	function refreshes() {
		return server.requests().filter(({ params }) => params.grant_type === "refresh_token");
	}

	async function sessionFor(sub, route = "/dashboard") {
		const { id, username } = account(sub);
		const cookie = `auth_token=${jwt.sign({ id, username }, secret, { expiresIn: "1h" })}`;
		const response = await get(server, route, cookie);
		await response.text();
		return response;
	}

	test("renews a token close to expiry and stores the rotated refresh token", async () => {
		expireSoon("sub-first");
		expect((await sessionFor("sub-first")).status).toBe(200);
		expect(refreshes().at(-1).params.refresh_token).toBe("rotate-1");
		expect(account("sub-first").oidc_token_expires_at).toBeGreaterThan(Date.now() / 1000 + 3000);

		// Admin pages refresh too, and present the rotated token.
		expireSoon("sub-first");
		expect((await sessionFor("sub-first", "/create-invite")).status).toBe(302);
		expect(refreshes().at(-1).params.refresh_token).toBe("rotate-2");
	});

	test("keeps the stored refresh token when the provider does not rotate it", async () => {
		await signIn(server, { claims: { sub: "sub-reader", email: "reader@example.com", groups: ["readers"] }, refreshToken: "keep-1" });
		for (let i = 0; i < 2; i++) {
			expireSoon("sub-reader");
			await sessionFor("sub-reader");
			expect(refreshes().at(-1).params.refresh_token).toBe("keep-1");
		}
	});

	test("does not end the session when a refresh cannot happen", async () => {
		await signIn(server, { claims: { sub: "sub-revoked", preferred_username: "revoked", groups: ["readers"] }, refreshToken: "revoked" });
		const count = refreshes().length;

		expireSoon("sub-revoked");
		expect((await sessionFor("sub-revoked")).status).toBe(200);
		expect(refreshes()).toHaveLength(count + 1);
		expect(account("sub-revoked").oidc_token_expires_at).toBeLessThan(Date.now() / 1000 + 300);

		// Unreadable stored tokens and accounts without one are not sent to the provider.
		for (const stored of ["not-sealed", "a.b.c", null]) {
			db.query("UPDATE users SET oidc_refresh_token = ? WHERE oidc_sub = 'sub-revoked'").run(stored);
			expect((await sessionFor("sub-revoked")).status).toBe(200);
		}
		db.query("UPDATE users SET oidc_refresh_token = 'a.b.c' WHERE oidc_sub = 'sub-boss'").run();
		expireSoon("sub-boss");
		expect((await sessionFor("sub-boss", "/create-invite")).status).toBe(302);
		expect(refreshes()).toHaveLength(count + 1);
	});
});

describe("single sign-on without auto-registration", () => {
	test("refuses unknown accounts", async () => {
		const response = await signIn(restricted, { claims: { sub: "sub-new", preferred_username: "newcomer", groups: ["readers"] } });

		expect(loginMessage(response)).toBe("Account not registered");
		const users = new Database(path.join(restricted.dataDir, "reddont.db"), { readonly: true });
		expect(users.query("SELECT COUNT(*) AS count FROM users").get().count).toBe(0);
		users.close();
	});

	test("still signs in an existing account by username", async () => {
		const users = new Database(path.join(restricted.dataDir, "reddont.db"));
		users.query("INSERT INTO users (username, password_hash) VALUES ('member', 'x')").run();
		const response = await signIn(restricted, { claims: { sub: "sub-member", preferred_username: "member", groups: ["readers"] } });

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/");
		expect(users.query("SELECT oidc_sub FROM users WHERE username = 'member'").get().oidc_sub).toBe("sub-member");
		users.close();
	});
});

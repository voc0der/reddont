const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const { Database } = require("bun:sqlite");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { responseCookies, startServer } = require("../test-support/server.cjs");

// The tests run in order and build on the accounts created by earlier ones.
const secret = "isolated-accounts-test-secret";
const csrf = "isolated-csrf-token-for-account-tests";
const realFetch = globalThis.fetch;
let server;
let db;

beforeAll(async () => {
	server = await startServer("accounts-server.cjs", "accounts-test", {
		JWT_SECRET_KEY: secret,
		REMOTE_HEADER_LOGIN: "true",
		REVERSE_PROXY_WHITELIST: "203.0.113.10",
	});
	db = new Database(path.join(server.dataDir, "reddont.db"));
}, 15000);

afterAll(async () => {
	db?.close();
	await server?.stop();
});

function user(username) {
	return db.query("SELECT * FROM users WHERE username = ?").get(username);
}

function sessionFor(username) {
	return jwt.sign({ id: user(username).id, username }, secret, { expiresIn: "1h" });
}

// A browser-style request: the CSRF cookie, an optional session, and form
// fields for a POST. `cookie` replaces the whole Cookie header.
function request(route, { token, fields, headers = {}, cookie } = {}) {
	return realFetch(server.baseUrl + route, {
		method: fields ? "POST" : "GET",
		headers: {
			Cookie: cookie ?? [`csrf_token=${csrf}`, token && `auth_token=${token}`].filter(Boolean).join("; "),
			...headers,
		},
		body: fields ? new URLSearchParams({ _csrf: csrf, ...fields }) : undefined,
		redirect: "manual",
	});
}

function redirectTarget(response) {
	expect(response.status).toBe(302);
	const location = new URL(response.headers.get("location"), "http://reddont.test");
	return { path: location.pathname, ...Object.fromEntries(location.searchParams) };
}

describe("registration", () => {
	test("the first account needs no invite and becomes the admin", async () => {
		expect(await (await request("/register")).text()).toContain('<button type="submit">register</button>');

		const response = await request("/register", {
			fields: { username: "owner", password: "owner-password", confirm_password: "owner-password" },
		});
		expect(redirectTarget(response)).toEqual({ path: "/" });
		expect(jwt.verify(responseCookies(response).auth_token.value, secret).username).toBe("owner");
		const owner = user("owner");
		expect(owner.isAdmin).toBe(1);
		expect(await Bun.password.verify("owner-password", owner.password_hash)).toBe(true);
	});

	test("later accounts need an invite", async () => {
		for (const [route, message] of [
			["/register", "this instance requires an invite"],
			["/register?token=unknown", "this invite token is invalid"],
		]) {
			const html = await (await request(route)).text();
			expect(html).toContain(message);
			expect(html).toMatch(/<button type="submit" disabled[^>]*>/);
		}
		const refused = await request("/register", {
			fields: { username: "uninvited", password: "pw", confirm_password: "pw" },
		});
		expect(await refused.text()).toContain("this instance requires an invite");
		expect(user("uninvited")).toBeNull();
	});

	test("an invite registers exactly one account", async () => {
		const owner = sessionFor("owner");
		expect(redirectTarget(await request("/create-invite", { token: owner }))).toEqual({ path: "/dashboard" });
		const invite = db.query("SELECT * FROM invites ORDER BY id DESC").get();
		expect(invite.token).toMatch(/^[0-9a-f]{10}$/);
		expect(await (await request("/dashboard", { token: owner })).text()).toContain(`href="/register?token=${invite.token}"`);

		const route = `/register?token=${invite.token}`;
		for (const [fields, status, message] of [
			[{ username: "reader", password: "pw" }, 400, "All fields are required"],
			[{ username: "reader", password: "pw", confirm_password: "other" }, 200, "passwords do not match, try again"],
			[{ username: "owner", password: "pw", confirm_password: "pw" }, 200, "user by the name &quot;owner&quot; exists"],
		]) {
			const response = await request(route, { fields });
			expect(response.status).toBe(status);
			expect(await response.text()).toContain(message);
		}
		expect(db.query("SELECT usedAt FROM invites WHERE id = ?").get(invite.id).usedAt).toBeNull();

		const response = await request(route, {
			fields: { username: "reader", password: "reader-password", confirm_password: "reader-password" },
		});
		expect(redirectTarget(response)).toEqual({ path: "/" });
		expect(user("reader").isAdmin).toBe(0);
		expect(db.query("SELECT usedAt FROM invites WHERE id = ?").get(invite.id).usedAt).not.toBeNull();

		for (const fields of [undefined, { username: "second", password: "pw", confirm_password: "pw" }]) {
			expect(await (await request(route, { fields })).text()).toContain("this invite has been claimed");
		}
		expect(user("second")).toBeNull();
	});

	test("only admins create invites, and admins can delete them", async () => {
		const refused = await request("/create-invite", { token: sessionFor("reader") });
		expect(refused.status).toBe(403);
		expect(await refused.text()).toBe("Only admins can access this route.");

		const owner = sessionFor("owner");
		await request("/create-invite", { token: owner });
		const { id } = db.query("SELECT id FROM invites ORDER BY id DESC").get();
		expect(redirectTarget(await request(`/delete-invite/${id}`, { token: owner }))).toEqual({ path: "/dashboard" });
		expect(db.query("SELECT id FROM invites WHERE id = ?").get(id)).toBeNull();
	});
});

describe("password login", () => {
	const owner = { username: "owner", password: "owner-password" };

	test("signs in and returns to the requested page", async () => {
		const route = `/login?redirect=${encodeURIComponent("/r/test?sort=new")}`;
		expect(await (await request(route)).text()).toContain('action="/login?redirect=%2Fr%2Ftest%3Fsort%3Dnew" method="post"');

		const response = await request(route, { fields: owner });
		expect(response.headers.get("location")).toBe("/r/test?sort=new");
		const { auth_token } = responseCookies(response);
		expect(jwt.verify(auth_token.value, secret)).toMatchObject({ id: user("owner").id, username: "owner" });
		expect(auth_token.attributes).toEqual(
			expect.arrayContaining(["max-age=432000", "path=/", "httponly", "samesite=strict"]),
		);
		// REDDONT_DISABLE_SSL serves plain HTTP, where a Secure cookie would never return.
		expect(auth_token.attributes).not.toContain("secure");
	});

	test("never redirects off the site", async () => {
		// URL parsing drops the tab in "/\t/", which leaves a "//" host reference.
		for (const redirect of ["//elsewhere.example/", "https://elsewhere.example/", "/\\elsewhere.example", "/\t/elsewhere.example/account", "javascript:alert(1)"]) {
			const response = await request(`/login?redirect=${encodeURIComponent(redirect)}`, { fields: owner });
			expect(response.headers.get("location")).toBe("/");
		}
		const repeated = await request("/login?redirect=%2Fsubs&redirect=%2F%2Felsewhere.example", { fields: owner });
		expect(repeated.headers.get("location")).toBe("/subs");
	});

	test("rejects missing and wrong credentials", async () => {
		for (const [fields, message] of [
			[{}, "Both username and password are required."],
			[{ username: "owner", password: "wrong-password" }, "Invalid credentials, try again."],
			[{ username: "nobody", password: "owner-password" }, "Invalid credentials, try again."],
		]) {
			const response = await request("/login", { fields });
			expect(response.status).toBe(200);
			expect(await response.text()).toContain(message);
			expect(responseCookies(response).auth_token).toBeUndefined();
		}
	});

	test("sends a signed-in reader home and signs them out", async () => {
		expect(redirectTarget(await request("/login", { token: sessionFor("owner") }))).toEqual({ path: "/" });

		const response = await request("/logout", { token: sessionFor("owner") });
		expect(redirectTarget(response)).toEqual({ path: "/login" });
		expect(responseCookies(response).auth_token.value).toBe("");
	});
});

describe("sessions", () => {
	test("an expired session asks the reader to sign in again", async () => {
		const token = jwt.sign({ id: user("owner").id, exp: Math.floor(Date.now() / 1000) - 60 }, secret);
		for (const route of ["/subs", "/create-invite"]) {
			const response = await request(route, { token });
			expect(redirectTarget(response)).toEqual({ path: "/login", redirect: route, message: "Session expired" });
			expect(responseCookies(response).auth_token.value).toBe("");
		}
		const login = await request("/login", { token });
		expect(await login.text()).toContain("Session expired");
		expect(responseCookies(login).auth_token.value).toBe("");
	});

	test("a session signed with another key is discarded", async () => {
		const token = jwt.sign({ id: user("owner").id }, "another-secret");
		for (const route of ["/subs", "/create-invite"]) {
			const response = await request(route, { token });
			expect(redirectTarget(response)).toEqual({ path: "/login", redirect: route });
			expect(responseCookies(response).auth_token.value).toBe("");
		}
		const login = await request("/login", { token });
		expect(login.status).toBe(200);
		expect(responseCookies(login).auth_token.value).toBe("");
	});

	test("a session for a removed account ends", async () => {
		const token = jwt.sign({ id: 9999, username: "removed" }, secret);
		expect(redirectTarget(await request("/subs", { token }))).toEqual({
			path: "/login",
			redirect: "/subs",
			message: "User not found.",
		});
		expect(redirectTarget(await request("/create-invite", { token }))).toEqual({
			path: "/login",
			redirect: "/create-invite",
			message: "Admin user not found.",
		});
		expect(await (await request("/login", { token })).text()).toContain("User not found.");
	});

	test("a session without an account id is matched by username", async () => {
		const token = jwt.sign({ username: "owner" }, secret);
		expect((await request("/subs", { token })).status).toBe(200);
	});

	test("anonymous visitors go to login with the page they wanted", async () => {
		for (const route of ["/subs", "/create-invite"]) {
			expect(redirectTarget(await request(route))).toEqual({ path: "/login", redirect: route });
		}
	});
});

describe("remote header sign-in", () => {
	test("creates an account for the user a trusted proxy names", async () => {
		const response = await request("/login?redirect=%2Fsubs", {
			headers: { "Remote-User": "proxied", "Remote-Groups": "staff, admin" },
		});
		expect(redirectTarget(response)).toEqual({ path: "/subs" });
		expect(jwt.verify(responseCookies(response).auth_token.value, secret).username).toBe("proxied");
		expect(user("proxied")).toMatchObject({ isAdmin: 1, groups: '["staff","admin"]' });
	});

	test("keeps the admin flag in step with the proxy's groups", async () => {
		await request("/login", { headers: { "Remote-User": "proxied", "Remote-Groups": "staff" } });
		expect(user("proxied")).toMatchObject({ isAdmin: 0, groups: '["staff"]' });

		const token = sessionFor("proxied");
		expect((await request("/create-invite", { token, headers: { "Remote-Groups": "staff,admin" } })).status).toBe(302);
		expect(user("proxied")).toMatchObject({ isAdmin: 1, groups: '["staff","admin"]' });

		expect((await request("/subs", { token, headers: { "Remote-Groups": "staff" } })).status).toBe(200);
		expect(user("proxied")).toMatchObject({ isAdmin: 0, groups: '["staff"]' });
		expect((await request("/create-invite", { token })).status).toBe(403);
	});

	test("treats a missing groups header as no admin rights and no group change", async () => {
		const response = await request("/login", { headers: { "Remote-User": "ungrouped" } });
		expect(redirectTarget(response)).toEqual({ path: "/" });
		expect(user("ungrouped")).toMatchObject({ isAdmin: 0, groups: "[]" });

		await request("/login", { headers: { "Remote-User": "proxied" } });
		expect(user("proxied")).toMatchObject({ isAdmin: 0, groups: '["staff"]' });
	});

	test("shows the login form when the proxy names no user", async () => {
		for (const headers of [{}, { "Remote-User": "  " }]) {
			const response = await request("/login", { headers });
			expect(response.status).toBe(200);
			expect(await response.text()).toContain('name="password"');
		}
	});
});

describe("preferences", () => {
	test("saves display preferences and treats unchecked boxes as off", async () => {
		const token = sessionFor("reader");
		const response = await request("/update-preferences", {
			token,
			fields: { infiniteScroll: "1", useClassicLayout: "1", themePreference: "dark", highResThumbnails: "1", showNsfwThumbnails: "1" },
		});
		expect(redirectTarget(response)).toEqual({ path: "/dashboard" });
		expect(user("reader")).toMatchObject({
			infiniteScroll: 1,
			useClassicLayout: 1,
			themePreference: "dark",
			highResThumbnails: 1,
			showNsfwThumbnails: 1,
		});

		await request("/update-preferences", { token, fields: {} });
		expect(user("reader")).toMatchObject({
			infiniteScroll: 0,
			useClassicLayout: 0,
			themePreference: "auto",
			highResThumbnails: 0,
			showNsfwThumbnails: 0,
		});
	});

	test("rejects an unusable Reddit credential without saving anything", async () => {
		const response = await request("/update-preferences", {
			token: sessionFor("reader"),
			fields: { themePreference: "light", redditAuthCredential: "not a credential", redditAuthType: "auto" },
		});
		expect(redirectTarget(response)).toEqual({ path: "/dashboard", message: "Invalid Reddit credential" });
		expect(user("reader")).toMatchObject({ themePreference: "auto", redditAuthHeaders: null });
	});

	test("the dashboard opens with an unreadable stored credential", async () => {
		db.query("UPDATE users SET redditAuthHeaders = ? WHERE username = 'reader'").run('{"cookie":"invalid"}');
		const response = await request("/dashboard", { token: sessionFor("reader") });

		expect(response.status).toBe(200);
		expect(await response.text()).toContain("Current: not configured");
		db.query("UPDATE users SET redditAuthHeaders = NULL WHERE username = 'reader'").run();
	});
});

describe("API keys", () => {
	function whoami(key) {
		return realFetch(`${server.baseUrl}/api/v1/whoami`, { headers: { "X-API-Key": key } });
	}

	test("a reader can generate, rotate, and revoke their key", async () => {
		const token = sessionFor("reader");
		expect(redirectTarget(await request("/api-key/regenerate", { token, fields: {} }))).toEqual({
			path: "/dashboard",
			message: "API key regenerated",
		});
		const first = user("reader").apiKey;
		expect(first).toStartWith("reddont_");
		expect(await (await whoami(first)).json()).toMatchObject({ username: "reader", isAdmin: false });
		expect(await (await request("/dashboard", { token })).text()).toContain(`value="${first}"`);

		await request("/api-key/regenerate", { token, fields: {} });
		const second = user("reader").apiKey;
		expect(second).not.toBe(first);
		expect((await whoami(first)).status).toBe(401);
		expect((await whoami(second)).status).toBe(200);

		expect(redirectTarget(await request("/api-key/revoke", { token, fields: {} }))).toEqual({
			path: "/dashboard",
			message: "API key revoked",
		});
		expect(user("reader").apiKey).toBeNull();
		expect((await whoami(second)).status).toBe(401);
	});
});

describe("request handling", () => {
	test("ignores malformed and unrelated cookies", async () => {
		const token = sessionFor("owner");
		const response = await request("/subs", {
			cookie: `=orphan; __proto__=polluted; constructor=x; bad name=x; theme=dark; flag; auth_token=${token}`,
		});
		expect(response.status).toBe(200);

		const garbled = await request("/subs", { cookie: "auth_token=%E0%A4%A" });
		expect(redirectTarget(garbled)).toEqual({ path: "/login", redirect: "/subs" });
	});

	test("rejects form posts without a matching CSRF token", async () => {
		const token = sessionFor("owner");
		for (const cookie of [`auth_token=${token}`, `auth_token=${token}; csrf_token=${"x".repeat(40)}`]) {
			const response = await realFetch(`${server.baseUrl}/update-preferences`, {
				method: "POST",
				headers: { Cookie: cookie },
				body: new URLSearchParams({ _csrf: csrf, themePreference: "dark" }),
				redirect: "manual",
			});
			expect(response.status).toBe(403);
		}
		expect(user("owner").themePreference).toBe("auto");
	});

	test("explains that single sign-on is not configured", async () => {
		for (const route of ["/auth/oidc/login", "/auth/oidc/callback?code=code&state=state"]) {
			expect(redirectTarget(await request(route))).toEqual({
				path: "/login",
				bypass_oidc: "true",
				message: "OIDC not configured",
			});
		}
	});
});

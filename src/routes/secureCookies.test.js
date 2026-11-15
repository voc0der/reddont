const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const jwt = require("jsonwebtoken");
const { responseCookies, startServer } = require("../test-support/server.cjs");

// Secure cookies, the default for HTTPS (no REDDONT_DISABLE_SSL), with header
// login on and no REVERSE_PROXY_WHITELIST.
const secret = "isolated-secure-cookie-secret";
const csrf = "isolated-csrf-token-for-secure-cookies";
let server;

beforeAll(async () => {
	server = await startServer("accounts-server.cjs", "accounts-test", {
		JWT_SECRET_KEY: secret,
		REDDONT_DISABLE_SSL: "false",
		REMOTE_HEADER_LOGIN: "true",
	});
	const registered = await request("/register", {
		fields: { username: "owner", password: "owner-password", confirm_password: "owner-password" },
	});
	expect(registered.status).toBe(302);
}, 15000);

afterAll(() => server?.stop());

function request(route, { cookie = `__Host-csrf_token=${csrf}`, fields, headers = {} } = {}) {
	return fetch(server.baseUrl + route, {
		method: fields ? "POST" : "GET",
		headers: { Cookie: cookie, ...headers },
		body: fields ? new URLSearchParams({ _csrf: csrf, ...fields }) : undefined,
		redirect: "manual",
	});
}

function session() {
	return jwt.sign({ id: 1, username: "owner" }, secret, { expiresIn: "1h" });
}

describe("secure cookies", () => {
	test("take the __Host- prefix: this host only, HTTPS only, the whole site", async () => {
		const page = responseCookies(await request("/login", { cookie: "" }));
		expect(page.csrf_token).toBeUndefined();
		expect(page["__Host-csrf_token"].attributes).toEqual(
			expect.arrayContaining(["path=/", "httponly", "secure", "samesite=strict"]),
		);

		const signedIn = await request("/login", { fields: { username: "owner", password: "owner-password" } });
		expect(signedIn.headers.get("location")).toBe("/");
		const cookies = responseCookies(signedIn);
		expect(cookies.auth_token).toBeUndefined();
		expect(jwt.verify(cookies["__Host-auth_token"].value, secret)).toMatchObject({ username: "owner" });
		for (const { attributes } of [page["__Host-csrf_token"], cookies["__Host-auth_token"]]) {
			expect(attributes.some((attribute) => attribute.startsWith("domain="))).toBe(false);
		}
		expect(cookies["__Host-auth_token"].attributes).toEqual(
			expect.arrayContaining(["path=/", "httponly", "secure", "samesite=strict"]),
		);

		const signedOut = responseCookies(await request("/logout", { cookie: `__Host-auth_token=${session()}` }));
		expect(signedOut["__Host-auth_token"].value).toBe("");
	});

	test("ignore bare names, which another subdomain could have set", async () => {
		expect((await request("/subs", { cookie: `__Host-auth_token=${session()}` })).status).toBe(200);
		const bare = await request("/subs", { cookie: `auth_token=${session()}` });
		expect(bare.status).toBe(302);
		expect(new URL(bare.headers.get("location"), server.baseUrl).pathname).toBe("/login");

		const planted = await request("/update-preferences", {
			cookie: `__Host-auth_token=${session()}; csrf_token=${csrf}`,
			fields: { themePreference: "dark" },
		});
		expect(planted.status).toBe(403);
		expect(await planted.text()).toBe("Invalid CSRF token");
	});
});

describe("forwarded addresses without REVERSE_PROXY_WHITELIST", () => {
	async function failedSignInFrom(peer, forwardedFor) {
		const response = await request("/login", {
			fields: { username: "nobody", password: "wrong" },
			headers: { "X-Test-Peer": peer, "X-Forwarded-For": forwardedFor },
		});
		expect(response.status).toBe(200);
	}

	test("count from a proxy on a private network", async () => {
		await failedSignInFrom("172.18.0.2", "198.51.100.9");
		await server.waitForLog('Failed sign-in for user "nobody" from 198.51.100.9');
	});

	test("never from anyone else who connects", async () => {
		await failedSignInFrom("203.0.113.20", "198.51.100.10");
		await server.waitForLog('Failed sign-in for user "nobody" from 203.0.113.20');
		expect(server.log()).not.toContain("198.51.100.10");
	});
});

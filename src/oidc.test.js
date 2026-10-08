const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } = require("bun:test");
const { authorizationCode, createFakeIdp, pkceChallenge } = require("./test-support/fake-idp.cjs");
const oidc = require("./oidc");

const SETTINGS = [
	"JWT_SECRET_KEY",
	"OIDC_ADMIN_CLAIM",
	"OIDC_ADMIN_VALUE",
	"OIDC_ALLOWED_GROUPS",
	"OIDC_CLIENT_ID",
	"OIDC_CLIENT_SECRET",
	"OIDC_ENABLED",
	"OIDC_GROUP_CLAIM",
	"OIDC_ISSUER_URL",
	"OIDC_REDIRECT_URI",
	"OIDC_SCOPE",
];
const PROVIDER = {
	OIDC_ENABLED: "true",
	OIDC_ISSUER_URL: "https://idp.test",
	OIDC_CLIENT_ID: "reddont",
	OIDC_CLIENT_SECRET: "client-secret",
	OIDC_REDIRECT_URI: "https://reddont.test/auth/oidc/callback",
};
const savedSettings = Object.fromEntries(SETTINGS.map((name) => [name, process.env[name]]));
const realFetch = globalThis.fetch;
let consoleSpies;
let requests;

// Replaces every OIDC setting, so a test only sees the values it names.
function configure(settings = {}) {
	for (const name of SETTINGS) {
		if (settings[name] === undefined) Reflect.deleteProperty(process.env, name);
		else process.env[name] = settings[name];
	}
}

beforeAll(() => {
	// Initialization logs every outcome; keep expected failures out of the test output.
	consoleSpies = ["log", "warn", "error"].map((method) => spyOn(console, method).mockImplementation(() => {}));
});

beforeEach(() => {
	requests = [];
	const idp = createFakeIdp({
		clientId: PROVIDER.OIDC_CLIENT_ID,
		clientSecret: PROVIDER.OIDC_CLIENT_SECRET,
		onRequest: (request) => requests.push(request),
	});
	globalThis.fetch = idp.fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	configure({});
});

afterAll(async () => {
	// Leave the shared module disabled for any later test file.
	await oidc.initializeOIDC();
	configure(savedSettings);
	for (const spy of consoleSpies) spy.mockRestore();
});

// Runs the authorization code flow; `forge` alters what the callback presents.
async function signIn(answer = {}, forge = {}) {
	const auth = await oidc.getAuthorizationUrl();
	const code = authorizationCode({
		nonce: auth.nonce,
		codeChallenge: new URL(auth.authorizationUrl).searchParams.get("code_challenge"),
		claims: { sub: "user-1" },
		...answer,
	});
	const result = await oidc.handleCallback(
		{ query: { code, state: auth.state, ...forge.query } },
		{ ...auth, ...forge.checks },
	);
	return { auth, ...result };
}

describe("initializeOIDC", () => {
	test("stays disabled unless switched on and fully configured", async () => {
		configure({ ...PROVIDER, OIDC_ENABLED: "false" });
		expect(await oidc.initializeOIDC()).toBe(false);
		configure({ ...PROVIDER, OIDC_CLIENT_SECRET: " " });
		expect(await oidc.initializeOIDC()).toBe(false);

		expect(oidc.isOIDCEnabled()).toBe(false);
		expect(oidc.getInitError()).toBeNull();
		expect(requests).toEqual([]);
		await expect(oidc.getAuthorizationUrl()).rejects.toThrow("OIDC not enabled");
		await expect(oidc.handleCallback({ query: {} })).rejects.toThrow("OIDC not enabled");
		expect(await oidc.refreshAccessToken(1)).toBe(false);
	});

	test("records a failed discovery and keeps sign-in disabled", async () => {
		configure({ ...PROVIDER, OIDC_ISSUER_URL: "https://idp.test/missing" });

		expect(await oidc.initializeOIDC()).toBe(false);
		expect(oidc.isOIDCEnabled()).toBe(false);
		expect(oidc.getInitError()).toBeInstanceOf(Error);
		expect(requests.map((request) => request.path)).toEqual(["/missing/.well-known/openid-configuration"]);
	});

	test("discovers the provider when enabled", async () => {
		configure({ ...PROVIDER, OIDC_ENABLED: "yes" });

		expect(await oidc.initializeOIDC({ jwtKey: "jwt-key" })).toBe(true);
		expect(oidc.isOIDCEnabled()).toBe(true);
		expect(oidc.getInitError()).toBeNull();
		expect(requests.map((request) => request.path)).toEqual(["/.well-known/openid-configuration"]);
	});
});

describe("sign-in", () => {
	beforeEach(async () => {
		configure(PROVIDER);
		expect(await oidc.initializeOIDC({ jwtKey: "jwt-key" })).toBe(true);
	});

	test("starts an authorization code flow with a fresh PKCE challenge", async () => {
		const auth = await oidc.getAuthorizationUrl({ redirectAfterLogin: "/r/test" });
		const url = new URL(auth.authorizationUrl);

		expect(`${url.origin}${url.pathname}`).toBe("https://idp.test/authorize");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: "reddont",
			response_type: "code",
			scope: "openid profile email",
			redirect_uri: "https://reddont.test/auth/oidc/callback",
			state: auth.state,
			nonce: auth.nonce,
			code_challenge: pkceChallenge(auth.code_verifier),
			code_challenge_method: "S256",
		});
		expect(auth.redirectAfterLogin).toBe("/r/test");

		const next = await oidc.getAuthorizationUrl();
		expect(next.redirectAfterLogin).toBe("/");
		expect(next.state).not.toBe(auth.state);
		expect(next.nonce).not.toBe(auth.nonce);
		expect(next.code_verifier).not.toBe(auth.code_verifier);
	});

	test("requests the configured scope", async () => {
		process.env.OIDC_SCOPE = "openid groups offline_access";
		const { authorizationUrl } = await oidc.getAuthorizationUrl();

		expect(new URL(authorizationUrl).searchParams.get("scope")).toBe("openid groups offline_access");
	});

	test("exchanges the code and lets userinfo claims take precedence", async () => {
		const { auth, claims, tokenSet } = await signIn({
			claims: { sub: "user-1", preferred_username: "reader", groups: ["readers"] },
			userinfo: { sub: "user-1", email: "reader@example.com", groups: ["readers", "admin"] },
			refreshToken: "rotate-1",
		});

		expect(claims).toMatchObject({
			sub: "user-1",
			preferred_username: "reader",
			email: "reader@example.com",
			groups: ["readers", "admin"],
		});
		expect(tokenSet.refresh_token).toBe("rotate-1");
		expect(requests.find((request) => request.path === "/token").params).toMatchObject({
			grant_type: "authorization_code",
			code_verifier: auth.code_verifier,
			redirect_uri: "https://reddont.test/auth/oidc/callback",
		});
	});

	test("keeps the ID token claims when userinfo fails or names another subject", async () => {
		for (const userinfo of ["fail", { sub: "someone-else", groups: ["admin"] }]) {
			const { claims } = await signIn({ claims: { sub: "user-1", groups: ["readers"] }, userinfo });
			expect(claims.sub).toBe("user-1");
			expect(claims.groups).toEqual(["readers"]);
		}
	});

	test("rejects a callback with a forged state, nonce, or verifier", async () => {
		await expect(signIn({}, { query: { state: "forged" } })).rejects.toThrow();
		await expect(signIn({}, { checks: { nonce: "forged" } })).rejects.toThrow();
		await expect(signIn({}, { checks: { code_verifier: "forged" } })).rejects.toThrow();
	});
});

describe("claims", () => {
	test("read groups from arrays, comma-separated strings, and nested paths", () => {
		expect(oidc.extractGroupsFromClaims({ groups: ["readers", " admin ", ""] })).toEqual(["readers", "admin"]);
		expect(oidc.extractGroupsFromClaims({ groups: "readers, admin,," })).toEqual(["readers", "admin"]);
		expect(oidc.extractGroupsFromClaims({})).toEqual([]);

		configure({ OIDC_GROUP_CLAIM: "realm_access.roles" });
		expect(oidc.extractGroupsFromClaims({ realm_access: { roles: ["readers"] } })).toEqual(["readers"]);
		expect(oidc.extractGroupsFromClaims({})).toEqual([]);

		configure({ OIDC_GROUP_CLAIM: "resource_access" });
		expect(oidc.extractGroupsFromClaims({ resource_access: { roles: ["editors"] } })).toEqual(["editors"]);
		expect(oidc.extractGroupsFromClaims({ resource_access: { groups: ["staff"] } })).toEqual(["staff"]);
		expect(oidc.extractGroupsFromClaims({ resource_access: 7 })).toEqual(["7"]);

		configure({ OIDC_GROUP_CLAIM: "teams[1].name" });
		expect(oidc.extractGroupsFromClaims({ teams: [{ name: "a" }, { name: "b" }] })).toEqual(["b"]);
		expect(oidc.extractGroupsFromClaims({ teams: [{ name: "a" }] })).toEqual([]);
		expect(oidc.extractGroupsFromClaims({ teams: { name: "a" } })).toEqual([]);

		configure({ OIDC_GROUP_CLAIM: "teams[first]" });
		expect(oidc.extractGroupsFromClaims({ teams: ["a"] })).toEqual([]);
	});

	test("fall back to the admin claim for groups when no group claim is set", () => {
		configure({ OIDC_ADMIN_CLAIM: "roles" });
		expect(oidc.extractGroupsFromClaims({ roles: ["owner"], groups: ["readers"] })).toEqual(["owner"]);
	});

	test("allow everyone without a group list and compare groups case-insensitively", () => {
		expect(oidc.isAllowedByGroups([])).toBe(true);
		configure({ OIDC_ALLOWED_GROUPS: " , " });
		expect(oidc.isAllowedByGroups([])).toBe(true);

		configure({ OIDC_ALLOWED_GROUPS: "Readers, Staff" });
		expect(oidc.isAllowedByGroups(["readers"])).toBe(true);
		expect(oidc.isAllowedByGroups(["guests"])).toBe(false);
		expect(oidc.isAllowedByGroups([])).toBe(false);
	});

	test("grant admin from the groups or a separate admin claim", () => {
		expect(oidc.isAdminFromClaims({ groups: ["Admin"] }, ["Admin"])).toBe(true);
		expect(oidc.isAdminFromClaims({ groups: ["readers"] }, ["readers"])).toBe(false);

		configure({ OIDC_ADMIN_CLAIM: "roles", OIDC_ADMIN_VALUE: "Owner" });
		expect(oidc.isAdminFromClaims({ roles: "viewer,owner" }, [])).toBe(true);
		expect(oidc.isAdminFromClaims({ roles: ["viewer"] }, ["admin"])).toBe(false);
	});

	test("choose the most specific username available", () => {
		const claims = { sub: "s", name: "n", upn: "u", email: "e", preferred_username: "p" };
		const order = [];
		for (const claim of ["preferred_username", "email", "upn", "name", "sub"]) {
			order.push(oidc.resolveUsernameFromClaims(claims));
			delete claims[claim];
		}
		expect(order).toEqual(["p", "e", "u", "n", "s"]);
	});

	test("compute token expiry from expires_at or expires_in", () => {
		const now = Math.floor(Date.now() / 1000);

		expect(oidc.computeExpiresAtSeconds(null)).toBeNull();
		expect(oidc.computeExpiresAtSeconds({ expires_at: "1786217886" })).toBe(1786217886);
		expect(oidc.computeExpiresAtSeconds({ expires_in: 300 })).toBeWithin(now + 300, now + 302);
		expect(oidc.computeExpiresAtSeconds({ access_token: "token" })).toBeNull();
	});
});

describe("refresh token storage", () => {
	test("seals tokens with authenticated encryption under a key from the JWT secret", async () => {
		configure(PROVIDER);
		await oidc.initializeOIDC({ jwtKey: "first-key" });
		const sealed = oidc.encryptRefreshToken("refresh-secret");

		expect(sealed.split(".")).toHaveLength(3);
		expect(sealed).not.toContain("refresh-secret");
		expect(oidc.encryptRefreshToken("refresh-secret")).not.toBe(sealed);
		expect(oidc.decryptRefreshToken(sealed)).toBe("refresh-secret");

		const [iv, tag, ciphertext] = sealed.split(".");
		const altered = Buffer.from(ciphertext, "base64");
		altered[0] ^= 1;
		expect(() => oidc.decryptRefreshToken(`${iv}.${tag}.${altered.toString("base64")}`)).toThrow();

		// The configured secret derives the same key after a restart; another secret cannot read it.
		configure({ ...PROVIDER, JWT_SECRET_KEY: "first-key" });
		await oidc.initializeOIDC();
		expect(oidc.decryptRefreshToken(sealed)).toBe("refresh-secret");
		await oidc.initializeOIDC({ jwtKey: "second-key" });
		expect(() => oidc.decryptRefreshToken(sealed)).toThrow();
	});

	test("treats missing or malformed values as no token", () => {
		expect(oidc.encryptRefreshToken("")).toBeNull();
		expect(oidc.decryptRefreshToken(null)).toBeNull();
		expect(oidc.decryptRefreshToken("plain-refresh-token")).toBeNull();
	});
});

const { describe, expect, test } = require("bun:test");
const {
	describeRedditAuthHeaders,
	describeRedditAuthPlan,
	getRedditAuthHeaders,
	getRedditAuthStatus,
	getRedditOAuthStatus,
	getRedditRequestOptions,
	hasRedditAuth,
	normalizeRedditAuthInput,
	normalizeRedditAuthPrimary,
	serializeRedditAuthHeaders,
} = require("./redditAuth");
const { getInstanceRedditAppId, isInstanceRedditOAuthOn, normalizeRedditAppId } = require("./redditOAuth");

describe("normalizeRedditAuthInput", () => {
	test("normalizes bearer authorization headers", () => {
		expect(
			normalizeRedditAuthInput("Authorization: Bearer abc123", "auto"),
		).toEqual({
			authorization: "Bearer abc123",
		});

		expect(normalizeRedditAuthInput("abc123", "bearer")).toEqual({
			authorization: "Bearer abc123",
		});

		expect(
			normalizeRedditAuthInput("Authorization: Bearer abc123", "bearer"),
		).toEqual({
			authorization: "Bearer abc123",
		});
	});

	test("normalizes cookie headers and devtools-style cookie lines", () => {
		expect(
			normalizeRedditAuthInput(
				"Cookie: reddit_session=abc; token_v2=def",
				"auto",
			),
		).toEqual({
			cookie: "reddit_session=abc; token_v2=def",
		});

		expect(
			normalizeRedditAuthInput(
				'redesign_out: "true"\nreddit_session: "abc"\ntoken_v2: "def"',
				"auto",
			),
		).toEqual({
			cookie: "redesign_out=true; reddit_session=abc; token_v2=def",
		});
	});

	test("normalizes full cookie headers with hard line breaks", () => {
		expect(
			normalizeRedditAuthInput(
				"Cookie: loid=abc\nZ0FB; csv=2; reddit_session=def",
				"auto",
			),
		).toEqual({
			cookie: "loid=abcZ0FB; csv=2; reddit_session=def",
		});

		expect(
			normalizeRedditAuthInput(
				"loid=abc\nZ0FB; csv=2; reddit_session=def",
				"cookie",
			),
		).toEqual({
			cookie: "loid=abcZ0FB; csv=2; reddit_session=def",
		});
	});

	test("supports a bare reddit_session value when selected", () => {
		expect(normalizeRedditAuthInput("abc.def", "reddit_session")).toEqual({
			cookie: "reddit_session=abc.def",
		});
	});

	test("round trips serialized stored headers", () => {
		const serialized = serializeRedditAuthHeaders({
			authorization: "Bearer abc123",
			cookie: "reddit_session=abc",
		});

		expect(getRedditAuthHeaders(serialized)).toEqual({
			authorization: "Bearer abc123",
			cookie: "reddit_session=abc",
		});
	});

	test("merges stored auth headers into Geddit request headers", async () => {
		const { Geddit } = await import("./geddit.js");
		const reddit = new Geddit();

		expect(
			reddit.getRequestHeaders({
				authHeaders: {
					authorization: "Bearer abc123",
					cookie: "reddit_session=abc",
				},
			}),
		).toMatchObject({
			Accept: "application/json",
			Authorization: "Bearer abc123",
			Cookie: "reddit_session=abc",
		});
	});

	test("does not pass invalid stored cookie headers to fetch", async () => {
		const { Geddit } = await import("./geddit.js");
		const reddit = new Geddit();
		const headers = reddit.getRequestHeaders({
			authHeaders: {
				cookie: "reddit_session=abc\nloid=def",
			},
		});

		expect(headers.Cookie).toBeUndefined();
		expect(() => new Headers(headers)).not.toThrow();
	});
});

describe("credential validation", () => {
	test("rejects control characters, whitespace in tokens, and oversized input", () => {
		expect(() => normalizeRedditAuthInput("Bearer abc\u0000def", "bearer")).toThrow("invalid header characters");
		expect(() => normalizeRedditAuthInput("reddit_session=abc\u0001", "cookie")).toThrow("invalid header characters");
		expect(() => normalizeRedditAuthInput("Bearer abc def", "bearer")).toThrow("must not contain whitespace");
		expect(() => normalizeRedditAuthInput("a".repeat(20001), "auto")).toThrow("too long");
		expect(normalizeRedditAuthInput("   ", "auto")).toBeNull();
	});

	test("skips malformed pairs and cookie export metadata", () => {
		expect(
			normalizeRedditAuthInput(
				"Cookie: reddit_session=abc; flag; =nameless; bad name=1; path=/; token_v2=def",
				"cookie",
			),
		).toEqual({ cookie: "reddit_session=abc; token_v2=def" });

		expect(
			normalizeRedditAuthInput(
				'reddit_session: "abc"\n\nDomain: .reddit.com\ntoken_v2: ""',
				"auto",
			),
		).toEqual({ cookie: "reddit_session=abc" });

		expect(normalizeRedditAuthInput("reddit_session=abc\n\ntoken_v2=def", "cookie")).toEqual({
			cookie: "reddit_session=abc; token_v2=def",
		});
	});

	test("combines a bare bearer line with cookies and treats unknown types as auto", () => {
		expect(normalizeRedditAuthInput("Bearer abc123\nreddit_session: def", "auto")).toEqual({
			authorization: "Bearer abc123",
			cookie: "reddit_session=def",
		});
		expect(normalizeRedditAuthInput("Bearer abc123", "token")).toEqual({
			authorization: "Bearer abc123",
		});
	});

	test("explains input that contains no credential", () => {
		expect(() => normalizeRedditAuthInput("hello world", "auto")).toThrow("Paste a Bearer authorization header");
		expect(() => normalizeRedditAuthInput("Domain: .reddit.com", "cookie")).toThrow("cookie name/value pairs");
	});

	test("accepts full cookie input for the reddit_session type and rejects invalid values", () => {
		expect(normalizeRedditAuthInput("reddit_session=abc; token_v2=def", "reddit_session")).toEqual({
			cookie: "reddit_session=abc; token_v2=def",
		});
		expect(() => normalizeRedditAuthInput("abc;def", "reddit_session")).toThrow("session cookie value is invalid");
	});
});

describe("stored credentials", () => {
	test("reads legacy plain-text values and ignores empty or non-object values", () => {
		expect(getRedditAuthHeaders("Bearer legacy")).toEqual({ authorization: "Bearer legacy" });
		expect(getRedditAuthHeaders(null)).toBeNull();
		expect(getRedditAuthHeaders("42")).toBeNull();
		expect(getRedditAuthHeaders("{}")).toBeNull();
		expect(serializeRedditAuthHeaders({})).toBeNull();
		expect(() => getRedditAuthHeaders(JSON.stringify({ cookie: "invalid" }))).toThrow();
	});

	test("describes what is configured without exposing values", () => {
		expect(getRedditAuthStatus(null)).toEqual({ configured: false, description: "not configured" });
		expect(describeRedditAuthHeaders(undefined)).toBe("not configured");
		const status = getRedditAuthStatus(
			JSON.stringify({ authorization: "Bearer secret", cookie: "reddit_session=secret; token_v2=secret" }),
		);
		expect(status).toEqual({
			configured: true,
			description: "bearer token and cookies (reddit_session, token_v2)",
		});
	});

	test("uses a reader's own credential and never authenticates anonymous requests", () => {
		const authorization = "Bearer personal";
		expect(getRedditRequestOptions({ id: 7, redditAuthHeaders: JSON.stringify({ authorization }) })).toEqual({
			authHeaders: { authorization },
		});
		expect(getRedditRequestOptions(undefined)).toEqual({});
		expect(getRedditRequestOptions({ redditAuthHeaders: JSON.stringify({ authorization }) })).toEqual({});
	});

	test("chains a reader's credential and OAuth app in the order they chose", () => {
		const cookie = "reddit_session=own";
		const reader = { id: 7, redditAuthHeaders: JSON.stringify({ cookie }), redditOAuthAppId: "own-app-id-7" };
		expect(getRedditRequestOptions(reader)).toEqual({
			authHeaders: { cookie },
			fallback: { oauthAppId: "own-app-id-7" },
		});
		expect(getRedditRequestOptions({ ...reader, redditAuthPrimary: "oauth" })).toEqual({
			oauthAppId: "own-app-id-7",
			fallback: { authHeaders: { cookie } },
		});
		expect(getRedditRequestOptions({ id: 7, redditOAuthAppId: "own-app-id-7", redditAuthPrimary: "cookie" })).toEqual({
			oauthAppId: "own-app-id-7",
		});
		// A saved app ID that no longer validates is skipped, not borrowed around.
		expect(getRedditRequestOptions({ ...reader, redditOAuthAppId: "bad id" })).toEqual({ authHeaders: { cookie } });
		expect(getRedditRequestOptions({ id: 7, redditOAuthAppId: "bad id" })).toEqual({});
	});

	test("describes a saved OAuth app by the end of its ID", () => {
		expect(getRedditOAuthStatus("H6-HjZ5pUPjaFQ")).toEqual({ configured: true, description: "app ID ending in jaFQ" });
		expect(getRedditOAuthStatus(null)).toEqual({ configured: false, description: "not configured" });
		expect(getRedditOAuthStatus("bad id")).toEqual({ configured: false, description: "not configured" });
	});

	test("knows when request options authenticate and which way goes first", () => {
		expect(hasRedditAuth({})).toBe(false);
		expect(hasRedditAuth(undefined)).toBe(false);
		expect(hasRedditAuth({ oauthAppId: "own-app-id-7" })).toBe(true);
		expect(hasRedditAuth({ authHeaders: { cookie: "a=b" } })).toBe(true);
		expect(["oauth", "cookie", "bearer", undefined].map(normalizeRedditAuthPrimary)).toEqual(["oauth", "cookie", "cookie", "cookie"]);
	});
});

describe("Reddit app IDs", () => {
	test("accept an installed app's ID, trimmed and unquoted", () => {
		expect(normalizeRedditAppId(" H6-HjZ5pUPjaFQ ")).toBe("H6-HjZ5pUPjaFQ");
		expect(normalizeRedditAppId('"abcdefghij_KLMNOPQRSTU"')).toBe("abcdefghij_KLMNOPQRSTU");
		expect(normalizeRedditAppId("")).toBeNull();
		expect(normalizeRedditAppId(undefined)).toBeNull();
	});

	test("reject anything that can't be an app ID", () => {
		for (const input of ["short", "has space inside", "a".repeat(41), "id:secret_value", "line\nbreak-app-id"]) {
			expect(() => normalizeRedditAppId(input)).toThrow("Reddit app ID is invalid");
		}
	});
});

describe("the instance's OAuth app", () => {
	test("is on only with USE_REDDIT_OAUTH and a usable REDDIT_APP_ID, as in teddit", () => {
		expect(getInstanceRedditAppId({ USE_REDDIT_OAUTH: "true", REDDIT_APP_ID: " instance-app-1 " })).toBe("instance-app-1");
		expect(getInstanceRedditAppId({ USE_REDDIT_OAUTH: "1", REDDIT_APP_ID: "instance-app-1" })).toBe("instance-app-1");
		for (const env of [
			{ REDDIT_APP_ID: "instance-app-1" },
			{ USE_REDDIT_OAUTH: "false", REDDIT_APP_ID: "instance-app-1" },
			{ USE_REDDIT_OAUTH: "true" },
			{ USE_REDDIT_OAUTH: "true", REDDIT_APP_ID: "not an app id" },
		]) {
			expect(getInstanceRedditAppId(env)).toBeNull();
		}
		expect(isInstanceRedditOAuthOn({ USE_REDDIT_OAUTH: "TRUE" })).toBe(true);
		expect(isInstanceRedditOAuthOn({})).toBe(false);
	});

	test("backs up a user's own ways, and an app with its ID is tried once", () => {
		const saved = { ...process.env };
		Object.assign(process.env, { USE_REDDIT_OAUTH: "true", REDDIT_APP_ID: "instance-app-1" });
		try {
			const cookie = "reddit_session=own";
			const reader = { id: 7, redditAuthHeaders: JSON.stringify({ cookie }) };
			expect(getRedditRequestOptions(reader)).toEqual({
				authHeaders: { cookie },
				fallback: { oauthAppId: "instance-app-1" },
			});
			expect(describeRedditAuthPlan(reader)).toBe("your saved credential, then this instance's OAuth app");
			const sameApp = { ...reader, redditOAuthAppId: "instance-app-1", redditAuthPrimary: "oauth" };
			expect(getRedditRequestOptions(sameApp)).toEqual({
				oauthAppId: "instance-app-1",
				fallback: { authHeaders: { cookie } },
			});
			expect(describeRedditAuthPlan(sameApp)).toBe("your OAuth app, then your saved credential");
			expect(getRedditRequestOptions(undefined)).toEqual({});
			expect(describeRedditAuthPlan(undefined)).toBe("no Reddit authentication");
		} finally {
			for (const name of ["USE_REDDIT_OAUTH", "REDDIT_APP_ID"]) {
				if (name in saved) process.env[name] = saved[name];
				else delete process.env[name];
			}
		}
	});
});

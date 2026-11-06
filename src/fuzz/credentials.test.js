// Fuzz tests: the Reddit credentials users paste into the dashboard. What they paste
// becomes the Cookie and Authorization headers sent to Reddit, and an app ID becomes
// a Basic credential, so whatever the input holds, those must be well-formed, with
// no line break that would start another header, or the input is refused.
const { describe, expect, test } = require("bun:test");
const fc = require("fast-check");
const { normalizeRedditAuthInput } = require("../redditAuth");
const { normalizeRedditAppId } = require("../redditOAuth");
const { check, timeout } = require("../test-support/fuzz.cjs");

const PIECES = ["Cookie:", "cookie: ", "Authorization:", "Bearer ", "bearer\t", "reddit_session", "token_v2", "=", ";", "; ",
	":", "\"", "'", "\n", "\r\n", "\r", "\t", " ", "\0", "\x7f", " ", "abc", "Z0FB", "%0d%0a", "Set-Cookie: x=y", "name", "domain"];
const input = fc.oneof(
	fc.array(fc.constantFrom(...PIECES), { maxLength: 12 }).map((parts) => parts.join("")),
	fc.string({ maxLength: 60 }),
	fc.string({ unit: "binary", maxLength: 30 }),
);
const kind = fc.constantFrom("auto", "cookie", "reddit_session", "bearer", "bogus", undefined);

// Header values may hold tabs, but no other control character.
const COOKIE = /^[A-Za-z0-9._-]+=[^;\0-\x08\x0A-\x1F\x7F]*(; [A-Za-z0-9._-]+=[^;\0-\x08\x0A-\x1F\x7F]*)*$/;
const BEARER = /^Bearer [^\s\0-\x1F\x7F]+$/;

// Refused with a message the dashboard can show, never an error from a bug.
function expectRefusal(error) {
	expect(error).toBeInstanceOf(Error);
	expect(error.constructor).toBe(Error);
}

describe("Fuzz: Reddit credentials", () => {
	test("become well-formed Cookie and Authorization headers, or are refused", () =>
		check("credentials become safe headers", fc.property(input, kind, (raw, type) => {
			let headers;
			try {
				headers = normalizeRedditAuthInput(raw, type);
			} catch (error) {
				expectRefusal(error);
				return;
			}
			if (headers === null) return;
			expect(Object.keys(headers).every((name) => name === "cookie" || name === "authorization")).toBe(true);
			expect(Object.keys(headers).length).toBeGreaterThan(0);
			if (headers.cookie !== undefined) expect(headers.cookie).toMatch(COOKIE);
			if (headers.authorization !== undefined) expect(headers.authorization).toMatch(BEARER);
		}), [
			// An Authorization line with another scheme came back as authorization: null.
			["Authorization:Cookie:\r\nCookie:Cookie:", "auto"],
			["Authorization: Basic abc\nreddit_session=abc", "auto"],
			// A bearer token of nothing but quotes came back as authorization: null.
			["''", "bearer"],
		]), timeout);

	const appId = fc.oneof(input, fc.stringMatching(/^[ "']{0,2}[A-Za-z0-9_:-]{8,42}[ "']{0,2}$/));

	test("accept as app IDs only names that make a single Basic credential", () =>
		check("app IDs make one credential", fc.property(appId, (raw) => {
			let id;
			try {
				id = normalizeRedditAppId(raw);
			} catch (error) {
				expectRefusal(error);
				return;
			}
			if (id === null) return;
			expect(id).toMatch(/^[A-Za-z0-9_-]{10,40}$/);
			// The app ID is the Basic credential's user name, with no secret after it.
			const decoded = Buffer.from(Buffer.from(`${id}:`).toString("base64"), "base64").toString();
			expect(decoded.split(":")).toEqual([id, ""]);
		})), timeout);
});

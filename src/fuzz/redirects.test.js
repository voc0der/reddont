// Fuzz tests: where reddont sends a browser. Login and its error pages redirect to
// a path taken from the request (?redirect=, the page that failed), so the path must
// keep the browser on this site however it is written.
const { describe, expect, test } = require("bun:test");
const fc = require("fast-check");
const { getSafeRedirectTarget } = require("../utils/safeRedirect");
const { check, timeout } = require("../test-support/fuzz.cjs");

// A page at this origin, as a browser reads a Location header on it.
const SITE = "https://reddont.example";

// The pieces that change how a URL is read: slashes and backslashes, dot segments
// plain and encoded, the tabs and line breaks URL parsers drop, and other hosts.
const PIECES = ["/", "//", "\\", ".", "..", "%2e", "%2E", "%2e%2e", "%2f", "%5c", "\t", "\n", "\r", " ",
	"@", ":", "?", "#", "evil.com", "r", "test", "login", "%00", "\0", "https:", "javascript:"];
const target = fc.oneof(
	fc.array(fc.constantFrom(...PIECES), { maxLength: 8 }).map((parts) => parts.join("")),
	fc.string({ maxLength: 40 }),
	fc.string({ unit: "grapheme", maxLength: 20 }),
);

describe("Fuzz: redirect targets", () => {
	test("send a browser only to a path on this site", () =>
		check("redirect targets stay on the site", fc.property(target, (value) => {
			const result = getSafeRedirectTarget(value);
			// A Location header can carry no control characters.
			expect(/[\0-\x1F\x7F]/.test(result)).toBe(false);
			expect(result.startsWith("/")).toBe(true);
			expect(new URL(result, SITE).origin).toBe(SITE);
		}), [
			// Dot segments resolved these into "//evil.com", another host.
			["/a/..//evil.com"],
			["/%2e%2e//evil.com"],
			["/.//evil.com"],
		]), timeout);

	test("keep an ordinary path with its query and fragment", () =>
		check("ordinary paths survive", fc.property(
			fc.array(fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/), { minLength: 1, maxLength: 4 }),
			fc.option(fc.stringMatching(/^[a-z]{1,5}=[a-z0-9]{0,5}$/), { nil: undefined }),
			fc.option(fc.stringMatching(/^[a-z0-9-]{1,8}$/), { nil: undefined }),
			(segments, query, fragment) => {
				const path = `/${segments.join("/")}${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`;
				expect(getSafeRedirectTarget(path)).toBe(path);
			},
		)), timeout);
});

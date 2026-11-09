// Fuzz tests: what reddont asks Reddit for. Sorts, communities, post and comment IDs
// and search terms all come from the request, so whatever they hold, every request
// must go to Reddit's hosts and to one of the endpoints reddont means to call. What
// old reddit's pages name goes back to Reddit too, so only fullnames may come out.
const { afterEach, describe, expect, test } = require("bun:test");
const fc = require("fast-check");
const { Geddit } = require("../geddit");
const { readListingPage } = require("../utils/redditPage");
const { check, timeout } = require("../test-support/fuzz.cjs");

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const HOSTS = ["https://www.reddit.com", "https://old.reddit.com", "https://oauth.reddit.com"];
// Every endpoint reddont calls, as a request path. Communities and IDs hold only
// the characters Reddit's names do.
const SORT = "(best|hot|new|top|rising|controversial)";
const COMMUNITIES = "(/r/[A-Za-z0-9_]+(\\+[A-Za-z0-9_]+)*)";
const ENDPOINTS = [
	new RegExp(`^${COMMUNITIES}?/${SORT}(\\.json|/)?$`),
	/^\/r\/[A-Za-z0-9_]+\/about(\.json)?$/,
	new RegExp(`^${COMMUNITIES}?/search(\\.json)?$`),
	/^\/subreddits\/search(\.json)?$/,
	/^\/comments\/[A-Za-z0-9_]+(\/comment\/[A-Za-z0-9_]+)?(\.json)?$/,
	/^\/api\/morechildren(\.json|\.api)?$/,
	/^\/api\/info(\.json|\.api)?$/,
	/^\/api\/v1\/access_token$/,
];

// Ordinary values and anything else: slashes, dot segments, encodings, hosts.
const PIECES = ["/", "..", ".", "%2e%2e", "%2f", "?", "#", "@", "\\", "+", "r/", "evil.com", "api", "v1", "me", "test", "abc123"];
const text = fc.oneof(
	fc.array(fc.constantFrom(...PIECES), { maxLength: 6 }).map((parts) => parts.join("")),
	fc.string({ maxLength: 24 }),
);
const sort = fc.oneof(fc.constantFrom("hot", "new", "top", "rising", "controversial", "best"), text);
const community = fc.oneof(fc.constantFrom("all", "popular", "test", "test+other", "r/test"), text,
	fc.array(text, { maxLength: 3 }).map((names) => names.join("+")));
const id = fc.oneof(fc.stringMatching(/^[a-z0-9]{1,13}$/), text);
const auth = fc.constantFrom(
	{},
	{ authHeaders: { cookie: "reddit_session=fuzz" } },
	{ authHeaders: { authorization: "Bearer fuzz" } },
	{ authHeaders: { cookie: "reddit_session=fuzz" }, fallback: { authHeaders: { authorization: "Bearer fuzz" } } },
);

// Answers like Reddit refusing the request, so each way and its fallback run.
function recordRequests() {
	const urls = [];
	globalThis.fetch = async (input) => {
		urls.push(new URL(input instanceof Request ? input.url : input));
		return new Response("<html>blocked</html>", { status: 403 });
	};
	return urls;
}

describe("Fuzz: Reddit requests", () => {
	test("reach only Reddit's hosts and the endpoints reddont calls", () =>
		check("requests stay on Reddit's endpoints", fc.asyncProperty(sort, community, id, id, fc.array(id, { maxLength: 3 }), text, auth,
			async (sortValue, communityValue, postId, commentId, children, query, requestOptions) => {
				const urls = recordRequests();
				const reddit = new Geddit();
				await reddit.getSubmissions(sortValue, communityValue, { after: query, t: query }, requestOptions);
				await reddit.getSubreddit(communityValue, requestOptions);
				await reddit.searchSubmissions(query, { sort: sortValue }, requestOptions);
				await reddit.searchSubreddits(query, {}, requestOptions);
				await reddit.searchAll(query, communityValue, { restrict_sr: "on" }, requestOptions);
				await reddit.getSubmissionComments(postId, { sort: sortValue }, requestOptions);
				await reddit.getSingleCommentThread(postId, commentId, { sort: sortValue }, requestOptions);
				await reddit.getMoreComments(postId, children, sortValue, requestOptions);
				await reddit.getPostsById([postId, ...children], requestOptions);
				for (const url of urls) {
					expect(HOSTS).toContain(url.origin);
					expect(ENDPOINTS.some((endpoint) => endpoint.test(url.pathname)), url.href).toBe(true);
					// Saved posts' ids go out in the query: fullnames only.
					if (url.pathname.startsWith("/api/info")) {
						expect(url.searchParams.get("id"), url.href).toMatch(/^t[0-9]_[A-Za-z0-9_]+(,t[0-9]_[A-Za-z0-9_]+)*$/);
					}
				}
			},
		), [
			["hot", "../api/v1/me", "abc", "def", [], "x", {}],
			["hot/../../api/v1/me", "test", "abc/../../api/v1/me", "%2e%2e", ["a/b"], "q", { authHeaders: { cookie: "reddit_session=fuzz" } }],
		]), timeout);
});

describe("Fuzz: old reddit's pages", () => {
	const value = fc.oneof(fc.stringMatching(/^t[0-9]_[a-z0-9]{1,8}$/), fc.string({ maxLength: 16 }));
	const href = fc.oneof(
		value.map((after) => `https://old.reddit.com/r/test/?count=25&after=${encodeURIComponent(after)}`),
		fc.string({ maxLength: 30 }),
	);
	const page = fc.tuple(fc.array(fc.tuple(value, value), { maxLength: 4 }), href).map(([things, next]) => {
		const attribute = (raw) => raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
		const rows = things.map(([name, sub]) => `<div class="thing" data-fullname="${attribute(name)}" data-subreddit-fullname="${attribute(sub)}"></div>`);
		return `<div id="siteTable">${rows.join("")}<span class="next-button"><a href="${attribute(next)}" rel="nofollow next">next</a></span></div>`;
	});

	test("name only posts, communities and next pages by their fullnames", () =>
		check("pages give only fullnames", fc.asyncProperty(page, async (html) => {
			const listing = await readListingPage(html);
			expect(listing).not.toBeNull();
			for (const name of listing.names) expect(name).toMatch(/^t[35]_[a-z0-9]+$/);
			for (const [name, sub] of listing.communities) {
				expect(listing.names).toContain(name);
				expect(sub).toMatch(/^t5_[a-z0-9]+$/);
			}
			if (listing.after !== null) expect(listing.after).toMatch(/^t[35]_[a-z0-9]+$/);
		})), timeout);
});

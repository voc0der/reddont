const { afterEach, describe, expect, spyOn, test } = require("bun:test");
const { Geddit } = require("./geddit");
const logger = require("./logger");

const realFetch = globalThis.fetch;
let requests;

function respond(body) {
	requests = [];
	globalThis.fetch = async (url, options) => {
		requests.push({ url: new URL(url), method: options?.method, headers: options?.headers, body: options?.body, redirect: options?.redirect });
		return typeof body === "function" ? body(new URL(url)) : Response.json(body);
	};
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

const listing = (children, after = null) => ({ kind: "Listing", data: { after, children } });
const post = (id) => ({ kind: "t3", data: { id, title: `Post ${id}` } });

const cookie = { authHeaders: { cookie: "reddit_session=abc" } };
const thing = (name, data = {}) => ({ kind: name.slice(0, 2), data: { name, id: name.slice(3), ...data } });
const nextLink = (after) => (after ? `<a href="https://old.reddit.com/x/?count=25&amp;after=${after}" rel="nofollow next">next</a>` : "");
const feedPage = (posts, after = null) =>
	`<div id="siteTable" class="sitetable linklisting">${posts
		.map(([name, community]) => `<div class=" thing link" data-fullname="${name}" data-subreddit-fullname="${community || ""}" data-promoted="false"></div>`)
		.join("")}<span class="next-button">${nextLink(after)}</span></div>`;
const searchPage = (names, after = null) =>
	`<div class=" listing search-result-listing">${names
		.map((name) => `<div class=" search-result" data-fullname="${name}"></div>`)
		.join("")}<span class="nextprev">${nextLink(after)}</span></div>`;

// Serves old reddit pages by path, and /api/info.api from `things` in its
// own order: reversed, so callers must restore the page's order.
function oldReddit(pages, things = [], info = null) {
	const byName = new Map(things.map((item) => [item.data.name, item]));
	respond((url) => {
		if (url.pathname === "/api/info.api") {
			if (info) return info(url);
			const names = url.searchParams.get("id").split(",");
			return Response.json(listing(names.map((name) => byName.get(name)).filter(Boolean).reverse()));
		}
		const page = pages[url.pathname];
		if (typeof page === "function") return page();
		return page === undefined
			? new Response("not found", { status: 404 })
			: new Response(page, { headers: { "content-type": "text/html; charset=UTF-8" } });
	});
}

describe("listing requests", () => {
	test("sanitize the sort and community path", async () => {
		respond(listing([post("a")], "t3_a"));
		const reddit = new Geddit();

		expect(await reddit.getSubmissions("bogus", "r/Test+bad name+other", { t: "week" })).toEqual({
			after: "t3_a",
			posts: [post("a")],
		});
		await reddit.getSubmissions("new");

		expect(requests.map(({ url }) => url.pathname)).toEqual(["/r/Test+other/hot.json", "/new.json"]);
		expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({ limit: "20", include_over_18: "true", t: "week" });
	});

	test("send bearer feeds to oauth.reddit.com and signed-out feeds to www.reddit.com's JSON", async () => {
		respond(listing([post("a")], "t3_a"));
		const reddit = new Geddit();

		expect(await reddit.getSubmissions("new", "all", {}, { authHeaders: { authorization: "Bearer abc" } })).toEqual({
			after: "t3_a",
			posts: [post("a")],
		});
		await reddit.getSubmissions("new", "all");

		expect(requests.map(({ url }) => `${url.origin}${url.pathname}`)).toEqual([
			"https://oauth.reddit.com/r/all/new",
			"https://www.reddit.com/r/all/new.json",
		]);
		expect(requests[0].headers.Authorization).toBe("Bearer abc");
	});

	test("send the reader's stored credential", async () => {
		respond(listing([]));
		await new Geddit().getSubreddit("test", { authHeaders: { cookie: "reddit_session=abc" } });
		await new Geddit().getSubreddit("test");

		expect(requests.map(({ url }) => url.href)).toEqual([
			"https://old.reddit.com/r/test/about.json",
			"https://www.reddit.com/r/test/about.json",
		]);
		expect(requests[0].headers.Cookie).toBe("reddit_session=abc");
	});

	test("make no about request for a multi-reddit, which has no about page", async () => {
		respond(listing([]));
		expect(await new Geddit().getSubreddit("test+other", cookie)).toBeNull();
		expect(requests).toEqual([]);
	});
});

describe("OAuth apps", () => {
	const TOKEN_PATH = "/api/v1/access_token";
	const urls = () => requests.map(({ url }) => `${url.origin}${url.pathname}`);
	// Grants a token per request, numbered, to the apps listed; refuses others.
	function oauthReddit(apps, answer) {
		let granted = 0;
		respond((url) => {
			if (url.pathname !== TOKEN_PATH) return answer(url, requests.at(-1));
			const app = atob(requests.at(-1).headers.Authorization.replace("Basic ", "")).replace(/:$/, "");
			return apps.includes(app)
				? Response.json({ access_token: `token-${++granted}`, token_type: "bearer", expires_in: 86400, scope: "*" })
				: Response.json({ message: "Unauthorized", error: 401 }, { status: 401 });
		});
	}

	test("get an installed app's token once, then read oauth.reddit.com with it", async () => {
		oauthReddit(["installed-app-1"], () => Response.json(listing([post("a")])));
		const reddit = new Geddit();
		const app = { oauthAppId: "installed-app-1" };

		expect(await reddit.getSubmissions("new", "test", { t: "day" }, app)).toEqual({ after: null, posts: [post("a")] });
		await reddit.searchSubmissions("gpu", {}, app);

		expect(urls()).toEqual([
			"https://www.reddit.com/api/v1/access_token",
			"https://oauth.reddit.com/r/test/new",
			"https://oauth.reddit.com/search",
		]);
		const [token, feed] = requests;
		expect(token.method).toBe("POST");
		expect(token.headers.Authorization).toBe(`Basic ${btoa("installed-app-1:")}`);
		expect(Object.fromEntries(new URLSearchParams(token.body))).toEqual({
			grant_type: "https://oauth.reddit.com/grants/installed_client",
			device_id: "DO_NOT_TRACK_THIS_DEVICE",
		});
		expect(Object.fromEntries(feed.url.searchParams)).toEqual({ limit: "20", include_over_18: "true", t: "day" });
		expect(feed.headers.Authorization).toBe("Bearer token-1");
		expect(feed.headers.Cookie).toBeUndefined();
	});

	test("share one token request and renew the token before it expires", async () => {
		let granted = 0;
		respond((url) =>
			url.pathname === TOKEN_PATH
				? Response.json({ access_token: `token-${++granted}`, expires_in: 600 })
				: Response.json(listing([])),
		);
		const reddit = new Geddit();
		const app = { oauthAppId: "renewed-app-1" };

		await Promise.all(["a", "b"].map((name) => reddit.getSubmissions("hot", name, {}, app)));
		// Renewed 5 minutes early.
		const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60 * 1000 + 1);
		try {
			await reddit.getSubmissions("hot", "c", {}, app);
		} finally {
			clock.mockRestore();
		}

		expect(requests.map(({ url, headers }) => (url.pathname === TOKEN_PATH ? "token" : `${url.pathname} ${headers.Authorization}`))).toEqual([
			"token",
			"/r/a/hot Bearer token-1",
			"/r/b/hot Bearer token-1",
			"token",
			"/r/c/hot Bearer token-2",
		]);
	});

	test("ask for a new token when oauth.reddit.com stops accepting one", async () => {
		oauthReddit(["revoked-token-app"], (url, request) =>
			request.headers.Authorization === "Bearer token-1"
				? Response.json({ message: "Unauthorized", error: 401 }, { status: 401 })
				: Response.json(listing([post("a")])),
		);
		const reddit = new Geddit();
		const app = { oauthAppId: "revoked-token-app" };

		expect(await reddit.getSubmissions("hot", "test", {}, app)).toBeNull();
		expect(await reddit.getSubmissions("hot", "test", {}, app)).toEqual({ after: null, posts: [post("a")] });
		expect(requests.map(({ headers }) => headers.Authorization)).toEqual([
			`Basic ${btoa("revoked-token-app:")}`,
			"Bearer token-1",
			`Basic ${btoa("revoked-token-app:")}`,
			"Bearer token-2",
		]);
	});

	test("skip an app Reddit refuses, without asking again for a minute", async () => {
		const warn = spyOn(logger, "warn").mockImplementation(() => {});
		try {
			oauthReddit([], () => Response.json([listing([post("post1")]), listing([])]));
			const reddit = new Geddit();
			const options = { oauthAppId: "refused-app-1", fallback: cookie };

			for (let i = 0; i < 2; i++) {
				expect(await reddit.getSubmissionComments("post1", {}, options)).toEqual({ submission: post("post1"), comments: [] });
			}
			expect(await reddit.getSubmissionComments("post1", {}, { oauthAppId: "refused-app-1" })).toBeNull();

			expect(urls()).toEqual([
				"https://www.reddit.com/api/v1/access_token",
				"https://old.reddit.com/comments/post1.json",
				"https://old.reddit.com/comments/post1.json",
			]);
			expect(warn).toHaveBeenCalledWith("Reddit refused an OAuth token request", { status: 401 });
		} finally {
			warn.mockRestore();
		}
	});
});

describe("fallbacks", () => {
	test("retry with the fallback when Reddit refuses the first way", async () => {
		respond((url) => {
			if (url.pathname === "/api/v1/access_token") return Response.json({ access_token: "fallback-token", expires_in: 86400 });
			if (url.hostname === "old.reddit.com") return new Response("<html>blocked</html>", { status: 403 });
			return Response.json([listing([post("post1")]), listing([])]);
		});
		const reddit = new Geddit();

		expect(await reddit.getSubmissionComments("post1", {}, { ...cookie, fallback: { oauthAppId: "fallback-app-1" } })).toEqual({
			submission: post("post1"),
			comments: [],
		});
		expect(requests.map(({ url }) => `${url.origin}${url.pathname}`)).toEqual([
			"https://old.reddit.com/comments/post1.json",
			"https://www.reddit.com/api/v1/access_token",
			"https://oauth.reddit.com/comments/post1",
		]);
		expect(requests[2].headers).not.toHaveProperty("Cookie");
	});

	test("make one request when the first way works", async () => {
		respond(listing([post("a")]));
		const reddit = new Geddit();

		expect(await reddit.getSubmissions("hot", "test", {}, { authHeaders: { authorization: "Bearer own" }, fallback: cookie })).not.toBeNull();
		expect(requests.map(({ url }) => url.origin)).toEqual(["https://oauth.reddit.com"]);
	});

	test("search communities with the fallback when the first answer is empty", async () => {
		respond((url) => Response.json(listing(url.hostname === "oauth.reddit.com" ? [thing("t5_a")] : [])));
		const reddit = new Geddit();
		const bearer = { authHeaders: { authorization: "Bearer abc" } };

		expect(await reddit.searchSubreddits("gpu", {}, { ...cookie, fallback: bearer })).toEqual({ after: null, items: [thing("t5_a")] });
		expect(await reddit.searchSubreddits("gpu", {}, { ...bearer, fallback: cookie })).toEqual({ after: null, items: [thing("t5_a")] });
		// An empty answer beats a failed fallback.
		respond((url) => (url.hostname === "oauth.reddit.com" ? new Response("blocked", { status: 403 }) : Response.json(listing([]))));
		expect(await reddit.searchSubreddits("gpu", {}, { ...cookie, fallback: bearer })).toEqual({ after: null, items: [] });
	});

	test("return null when every way fails", async () => {
		respond(() => new Response("<html>blocked</html>", { status: 403 }));
		expect(await new Geddit().getSubmissionComments("post1", {}, { ...cookie, fallback: { authHeaders: { authorization: "Bearer abc" } } })).toBeNull();
		expect(requests.map(({ url }) => url.origin)).toEqual(["https://old.reddit.com", "https://oauth.reddit.com"]);
	});
});

describe("comment threads", () => {
	test("request the post and a single thread with the chosen options", async () => {
		respond([listing([post("post1")]), listing([{ kind: "t1", data: { id: "c1" } }])]);
		const reddit = new Geddit();

		expect(await reddit.getSubmissionComments("post1", { sort: "new" })).toEqual({
			submission: post("post1"),
			comments: [{ kind: "t1", data: { id: "c1" } }],
		});
		await reddit.getSingleCommentThread("post1", "c1", { sort: "top" });

		expect(requests.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
			"/comments/post1.json?sort=new",
			"/comments/post1/comment/c1.json?sort=top",
		]);
	});

	test("load discussions and threads from old.reddit.com when sending a cookie", async () => {
		respond([listing([post("post1")]), listing([{ kind: "t1", data: { id: "c1" } }])]);
		const reddit = new Geddit();
		const cookie = { authHeaders: { cookie: "reddit_session=abc" } };

		expect(await reddit.getSubmissionComments("post1", { sort: "new" }, cookie)).toEqual({
			submission: post("post1"),
			comments: [{ kind: "t1", data: { id: "c1" } }],
		});
		await reddit.getSingleCommentThread("post1", "c1", { sort: "top" }, cookie);
		await reddit.getSubmissionComments("post1", { sort: "new" }, { authHeaders: { authorization: "Bearer abc" } });

		expect(requests.map(({ url }) => url.href)).toEqual([
			"https://old.reddit.com/comments/post1.json?sort=new",
			"https://old.reddit.com/comments/post1/comment/c1.json?sort=top",
			"https://oauth.reddit.com/comments/post1?sort=new",
		]);
		expect(requests[0].headers.Cookie).toBe("reddit_session=abc");
	});

	test("load more from old.reddit.com when sending a cookie", async () => {
		const things = [{ kind: "t1", data: { id: "c1" } }];
		respond({ json: { errors: [], data: { things } } });
		const reddit = new Geddit();

		expect(await reddit.getMoreComments("post1", ["c1", "c2"], "new", { authHeaders: { cookie: "reddit_session=abc" } })).toEqual(things);
		await reddit.getMoreComments("post1", ["c1"], "top", { authHeaders: { authorization: "Bearer abc" } });

		expect(requests.map(({ url }) => `${url.origin}${url.pathname}`)).toEqual([
			"https://old.reddit.com/api/morechildren.api",
			"https://oauth.reddit.com/api/morechildren",
		]);
		expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({ api_type: "json", link_id: "t3_post1", children: "c1,c2", sort: "new" });
		expect(requests[0].headers.Cookie).toBe("reddit_session=abc");
	});

	test("reject unsafe identifiers before making a request", async () => {
		respond(listing([]));
		const reddit = new Geddit();

		expect(await reddit.getSubreddit("../user/someone")).toBeNull();
		expect(await reddit.getSubreddit(["test"])).toBeNull();
		expect(await reddit.getSubmissionComments("../api/me")).toBeNull();
		expect(await reddit.getSubmissionComments(42)).toBeNull();
		expect(await reddit.getSingleCommentThread("post1", "c1/../../me")).toBeNull();
		expect(await reddit.getSingleCommentThread("", "c1")).toBeNull();
		expect(await reddit.searchAll("gpu", "//evil.example/x")).toBeNull();
		expect(await reddit.searchAll("gpu", ["test"])).toBeNull();
		expect(requests).toEqual([]);
	});
});

describe("search requests", () => {
	test("search posts, communities, and a single community", async () => {
		respond(listing([post("a")], "t3_a"));
		const reddit = new Geddit();

		expect(await reddit.searchSubmissions("gpu", { sort: "new" })).toEqual({ after: "t3_a", items: [post("a")] });
		await reddit.searchSubreddits("gpu");
		await reddit.searchAll("gpu", "buildapcsales", { restrict_sr: "on", type: "link" });

		const [submissions, communities, restricted] = requests.map(({ url }) => url);
		expect(submissions.pathname).toBe("/search.json");
		expect(Object.fromEntries(submissions.searchParams)).toEqual({ sort: "new", q: "gpu", type: "link" });
		expect(communities.pathname).toBe("/subreddits/search.json");
		expect(Object.fromEntries(communities.searchParams)).toEqual({ limit: "25", include_over_18: "false", q: "gpu" });
		expect(restricted.pathname).toBe("/r/buildapcsales/search.json");
		expect(Object.fromEntries(restricted.searchParams)).toMatchObject({ q: "gpu", restrict_sr: "on", type: "link" });
	});

	test("search communities from old.reddit.com's JSON when sending a cookie", async () => {
		respond(listing([post("a")], "t3_a"));
		const reddit = new Geddit();

		expect(await reddit.searchSubreddits("gpu", {}, cookie)).toEqual({ after: "t3_a", items: [post("a")] });
		await reddit.searchSubmissions("gpu", {}, { authHeaders: { authorization: "Bearer abc" } });
		await reddit.searchSubmissions("gpu");

		expect(requests.map(({ url }) => `${url.origin}${url.pathname}`)).toEqual([
			"https://old.reddit.com/subreddits/search.json",
			"https://oauth.reddit.com/search",
			"https://www.reddit.com/search.json",
		]);
		expect(requests[0].headers.Cookie).toBe("reddit_session=abc");
	});

	test("merge the community and post listings of a mixed search", async () => {
		const community = { kind: "t5", data: { display_name: "gpus" } };
		respond([listing([community]), listing([post("a")], "t3_a")]);

		expect(await new Geddit().searchAll("gpu")).toEqual({ after: "t3_a", items: [community, post("a")] });
		expect(requests[0].url.searchParams.get("type")).toBe("sr,link,user");
	});
});

describe("cookie listings from old reddit's pages", () => {
	test("read a feed's page, then load its posts and their communities", async () => {
		oldReddit({ "/r/all/new/": feedPage([["t3_a", "t5_x"], ["t3_b", "t5_y"]], "t3_b") }, [
			thing("t3_a", { subreddit_id: "t5_x" }),
			thing("t3_b", { subreddit_id: "t5_y" }),
			thing("t5_x"),
			thing("t5_y"),
		]);

		expect(await new Geddit().getSubmissions("new", "all", { sr_detail: true, after: "t3_z", count: 25 }, cookie)).toEqual({
			after: "t3_b",
			posts: [
				thing("t3_a", { subreddit_id: "t5_x", sr_detail: thing("t5_x").data }),
				thing("t3_b", { subreddit_id: "t5_y", sr_detail: thing("t5_y").data }),
			],
		});
		expect(requests.map(({ url }) => url.href)).toEqual([
			"https://old.reddit.com/r/all/new/?limit=20&include_over_18=true&after=t3_z&count=25",
			"https://old.reddit.com/api/info.api?id=t3_a%2Ct3_b%2Ct5_x%2Ct5_y",
		]);
		expect(requests.every(({ headers }) => headers.Cookie === "reddit_session=abc")).toBe(true);
		expect(requests.map(({ headers }) => headers.Accept)).toEqual(["text/html", "application/json"]);
		expect(requests[0].redirect).toBe("manual");
	});

	test("keep the page's order and skip posts Reddit no longer returns", async () => {
		oldReddit({ "/hot/": feedPage([["t3_a"], ["t3_gone"], ["t3_c"]]) }, [thing("t3_a"), thing("t3_c")]);

		expect(await new Geddit().getSubmissions("hot", null, {}, cookie)).toEqual({
			after: null,
			posts: [thing("t3_a"), thing("t3_c")],
		});
		expect(requests[1].url.searchParams.get("id")).toBe("t3_a,t3_gone,t3_c");
	});

	test("load posts in batches of 100", async () => {
		const names = Array.from({ length: 101 }, (_, i) => `t3_p${i}`);
		oldReddit({ "/r/test/hot/": feedPage(names.map((name) => [name])) }, names.map((name) => thing(name)));

		const listing = await new Geddit().getSubmissions("hot", "test", { limit: 101 }, cookie);

		expect(listing.posts.map((item) => item.data.name)).toEqual(names);
		expect(requests.slice(1).map(({ url }) => url.searchParams.get("id").split(",").length)).toEqual([100, 1]);
	});

	test("make no info request for an empty page", async () => {
		oldReddit({ "/r/quiet/hot/": '<div id="siteTable"><p id="noresults" class="error">nothing here</p></div>' });

		expect(await new Geddit().getSubmissions("hot", "quiet", {}, cookie)).toEqual({ after: null, posts: [] });
		expect(requests).toHaveLength(1);
	});

	test("return null when Reddit refuses, redirects, or sends no listing", async () => {
		const warn = spyOn(logger, "warn").mockImplementation(() => {});
		try {
			const pages = [
				() => new Response("<html>blocked</html>", { status: 403 }),
				() => new Response(null, { status: 302, headers: { location: "https://old.reddit.com/subreddits/search?q=test" } }),
				'<form id="login-form"></form>',
			];
			for (const page of pages) {
				oldReddit({ "/r/test/hot/": page });
				expect(await new Geddit().getSubmissions("hot", "test", {}, cookie)).toBeNull();
				expect(requests).toHaveLength(1);
			}
			expect(warn.mock.calls).toEqual([
				["Reddit refused a feed request", { host: "old.reddit.com", status: 403 }],
				[
					"Reddit refused a feed request",
					{ host: "old.reddit.com", status: 302, location: "https://old.reddit.com/subreddits/search" },
				],
				["Reddit sent a feed page without a listing", { host: "old.reddit.com", status: 200 }],
			]);

			warn.mockClear();
			oldReddit({ "/r/test/hot/": feedPage([["t3_a"]]) }, [], () => new Response("<html>blocked</html>", { status: 403 }));
			expect(await new Geddit().getSubmissions("hot", "test", {}, cookie)).toBeNull();
			expect(warn.mock.calls).toEqual([["Reddit refused a feed request", { host: "old.reddit.com", status: 403 }]]);
		} finally {
			warn.mockRestore();
		}
	});

	test("follow a multi's redirect to its canonical spelling, and go there directly next time", async () => {
		const canonical = "/r/linux+programming/hot/";
		oldReddit(
			{
				"/r/Linux+Programming+gone/hot/": () =>
					new Response(null, { status: 301, headers: { location: `${canonical}?limit=20&include_over_18=true` } }),
				[canonical]: feedPage([["t3_a"]], "t3_a"),
			},
			[thing("t3_a")],
		);
		const reddit = new Geddit();

		expect(await reddit.getSubmissions("hot", "Linux+Programming+gone", {}, cookie)).toEqual({
			after: "t3_a",
			posts: [thing("t3_a")],
		});
		expect(await reddit.getSubmissions("hot", "Linux+Programming+gone", { after: "t3_a", count: 25 }, cookie)).toEqual({
			after: "t3_a",
			posts: [thing("t3_a")],
		});

		expect(requests.map(({ url }) => `${url.pathname}${url.search}`)).toEqual([
			"/r/Linux+Programming+gone/hot/?limit=20&include_over_18=true",
			`${canonical}?limit=20&include_over_18=true`,
			"/api/info.api?id=t3_a",
			`${canonical}?limit=20&include_over_18=true&after=t3_a&count=25`,
			"/api/info.api?id=t3_a",
		]);
		expect(requests.every(({ headers }) => headers.Cookie === "reddit_session=abc")).toBe(true);
	});

	test("refuse redirects to another kind of page, another host, or in a loop", async () => {
		const redirect = (location) => () => new Response(null, { status: 302, headers: { location } });
		oldReddit({
			"/r/gone/hot/": redirect("https://old.reddit.com/subreddits/search?q=gone"),
			"/r/signedout/hot/": redirect("/login/?dest=https%3A%2F%2Fold.reddit.com%2Fr%2Fsignedout%2Fhot%2F"),
			"/r/elsewhere/hot/": redirect("https://www.reddit.com/r/elsewhere/hot/"),
			"/r/loop/hot/": redirect("/r/Loop/hot/"),
			"/r/Loop/hot/": redirect("/r/loop/hot/"),
		});
		const warn = spyOn(logger, "warn").mockImplementation(() => {});
		try {
			const reddit = new Geddit();
			for (const community of ["gone", "signedout", "elsewhere", "loop"]) {
				expect(await reddit.getSubmissions("hot", community, {}, cookie)).toBeNull();
			}

			expect(warn.mock.calls.map(([, details]) => details.location)).toEqual([
				"https://old.reddit.com/subreddits/search",
				"https://old.reddit.com/login/",
				"https://www.reddit.com/r/elsewhere/hot/",
				"https://old.reddit.com/r/Loop/hot/",
			]);
			expect(requests.map(({ url }) => url.pathname)).toEqual([
				"/r/gone/hot/",
				"/r/signedout/hot/",
				"/r/elsewhere/hot/",
				"/r/loop/hot/",
				"/r/Loop/hot/",
				"/r/loop/hot/",
			]);
			expect(reddit.canonicalPages.size).toBe(0);
		} finally {
			warn.mockRestore();
		}
	});

	test("keep the canonical paths of the 100 most recently redirected pages", async () => {
		respond((url) =>
			url.pathname === "/api/info.api"
				? Response.json(listing([]))
				: url.pathname.startsWith("/r/A")
					? new Response(null, { status: 301, headers: { location: url.pathname.toLowerCase() } })
					: new Response(feedPage([]), { headers: { "content-type": "text/html" } }),
		);
		const reddit = new Geddit();

		for (let i = 0; i <= 100; i++) await reddit.getSubmissions("hot", `A${i}`, {}, cookie);

		expect(reddit.canonicalPages.size).toBe(100);
		expect(reddit.canonicalPages.has("/r/A0/hot/")).toBe(false);
		expect(reddit.canonicalPages.get("/r/A100/hot/")).toBe("/r/a100/hot/");
	});

	test("search posts from the page, then load their communities", async () => {
		oldReddit({ "/search": searchPage(["t3_a", "t3_b"], "t3_b") }, [
			thing("t3_a", { subreddit_id: "t5_x" }),
			thing("t3_b", { subreddit_id: "t5_x" }),
			thing("t5_x"),
		]);

		expect(await new Geddit().searchSubmissions("gpu", { sr_detail: true, sort: "new" }, cookie)).toEqual({
			after: "t3_b",
			items: [
				thing("t3_a", { subreddit_id: "t5_x", sr_detail: thing("t5_x").data }),
				thing("t3_b", { subreddit_id: "t5_x", sr_detail: thing("t5_x").data }),
			],
		});
		expect(requests.map(({ url }) => url.href)).toEqual([
			"https://old.reddit.com/search?sort=new&q=gpu&type=link",
			"https://old.reddit.com/api/info.api?id=t3_a%2Ct3_b",
			"https://old.reddit.com/api/info.api?id=t5_x",
		]);
	});

	test("keep search results when their communities fail to load", async () => {
		oldReddit({ "/search": searchPage(["t3_a"]) }, [], (url) =>
			url.searchParams.get("id") === "t3_a"
				? Response.json(listing([thing("t3_a", { subreddit_id: "t5_x" })]))
				: new Response("<html>blocked</html>", { status: 403 }),
		);
		const warn = spyOn(logger, "warn").mockImplementation(() => {});
		try {
			expect(await new Geddit().searchSubmissions("gpu", { sr_detail: true }, cookie)).toEqual({
				after: null,
				items: [thing("t3_a", { subreddit_id: "t5_x" })],
			});
		} finally {
			warn.mockRestore();
		}
	});

	test("search a community, or communities and posts, from the page", async () => {
		oldReddit(
			{
				"/r/buildapcsales/search": searchPage(["t5_x", "t3_a"]),
				"/search": searchPage(["t5_x", "t3_a"], "t3_a"),
			},
			[thing("t5_x"), thing("t3_a")],
		);
		const reddit = new Geddit();

		expect(await reddit.searchAll("gpu", "buildapcsales", { restrict_sr: "on", type: "link" }, cookie)).toEqual({
			after: null,
			items: [thing("t3_a")],
		});
		expect(await reddit.searchAll("gpu", null, {}, cookie)).toEqual({ after: "t3_a", items: [thing("t5_x"), thing("t3_a")] });
		expect(requests.filter(({ url }) => url.pathname !== "/api/info.api").map(({ url }) => url.href)).toEqual([
			"https://old.reddit.com/r/buildapcsales/search?limit=25&include_over_18=true&type=link&restrict_sr=on&q=gpu",
			"https://old.reddit.com/search?limit=25&include_over_18=true&type=sr%2Clink%2Cuser&q=gpu",
		]);
	});
});

describe("upstream failures", () => {
	const calls = {
		getSubmissions: (reddit) => reddit.getSubmissions("hot", "test"),
		getSubreddit: (reddit) => reddit.getSubreddit("test"),
		getSubmissionComments: (reddit) => reddit.getSubmissionComments("post1"),
		getSingleCommentThread: (reddit) => reddit.getSingleCommentThread("post1", "c1"),
		getMoreComments: (reddit) => reddit.getMoreComments("post1", ["c1"]),
		searchSubmissions: (reddit) => reddit.searchSubmissions("gpu"),
		searchSubreddits: (reddit) => reddit.searchSubreddits("gpu"),
		searchAll: (reddit) => reddit.searchAll("gpu", "test"),
	};

	test.each(Object.keys(calls))("%s returns null for network errors and block pages", async (name) => {
		const failures = [
			() => Promise.reject(new TypeError("fetch failed")),
			() => new Response("<html>blocked</html>", { status: 403 }),
		];
		for (const failure of failures) {
			respond(failure);
			expect(await calls[name](new Geddit())).toBeNull();
		}
	});
});

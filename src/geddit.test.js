const { afterEach, describe, expect, test } = require("bun:test");
const { Geddit } = require("./geddit");

const realFetch = globalThis.fetch;
let requests;

function respond(body) {
	requests = [];
	globalThis.fetch = async (url, options) => {
		requests.push({ url: new URL(url), headers: options?.headers });
		return typeof body === "function" ? body() : Response.json(body);
	};
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

const listing = (children, after = null) => ({ kind: "Listing", data: { after, children } });
const post = (id) => ({ kind: "t3", data: { id, title: `Post ${id}` } });

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

	test("send the reader's stored credential", async () => {
		respond(listing([]));
		await new Geddit().getSubreddit("test", { authHeaders: { cookie: "reddit_session=abc" } });

		expect(requests[0].url.pathname).toBe("/r/test/about.json");
		expect(requests[0].headers.Cookie).toBe("reddit_session=abc");
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

	test("reject unsafe identifiers before making a request", async () => {
		respond(listing([]));
		const reddit = new Geddit();

		expect(await reddit.getSubreddit("../user/someone")).toBeNull();
		expect(await reddit.getSubreddit(["test"])).toBeNull();
		expect(await reddit.getSubmissionComments("../api/me")).toBeNull();
		expect(await reddit.getSubmissionComments(42)).toBeNull();
		expect(await reddit.getSingleCommentThread("post1", "c1/../../me")).toBeNull();
		expect(await reddit.getSingleCommentThread("", "c1")).toBeNull();
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

	test("merge the community and post listings of a mixed search", async () => {
		const community = { kind: "t5", data: { display_name: "gpus" } };
		respond([listing([community]), listing([post("a")], "t3_a")]);

		expect(await new Geddit().searchAll("gpu")).toEqual({ after: "t3_a", items: [community, post("a")] });
		expect(requests[0].url.searchParams.get("type")).toBe("sr,link,user");
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

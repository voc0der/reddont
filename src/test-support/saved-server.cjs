// Isolated Reddit fixture for saved posts and comments: a feed, a
// discussion, and /api/info for the saved page.
const fs = require("node:fs");
const path = require("node:path");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".saved-test")) || fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("Saved post tests require a marked, empty temporary data directory");
}
const { db } = require("../db");
db.query("INSERT INTO users (username) VALUES ('saver')").run();

const now = Date.now() / 1000;
const listing = (children) => ({ kind: "Listing", data: { after: null, children } });
const community = { kind: "t5", data: { name: "t5_test", display_name: "test", subscribers: 1200 } };
const post = (id) => ({
	kind: "t3",
	data: {
		id, name: `t3_${id}`, author: "poster", subreddit: "test", subreddit_id: "t5_test",
		title: `Post ${id}`, created: now - 60, created_utc: now - 60, num_comments: 0, score: 1, ups: 1,
		is_self: true, domain: "self.test", permalink: `/r/test/comments/${id}/post/`,
		url: `https://www.reddit.com/r/test/comments/${id}/post/`,
	},
});
// Like /api/info's comments: no title for the post they're on.
const comment = (id, postId) => ({
	kind: "t1",
	data: {
		id, name: `t1_${id}`, link_id: `t3_${postId}`, parent_id: `t3_${postId}`, author: "commenter",
		subreddit: "test", subreddit_id: "t5_test", score: 4, ups: 4, created: now - 30, created_utc: now - 30, edited: false,
		body_html: `&lt;div class="md"&gt;&lt;p&gt;Comment ${id}: &amp;lt;b&amp;gt; stays text.&lt;/p&gt;&lt;/div&gt;`,
		permalink: `/r/test/comments/${postId}/post/${id}/`, replies: "",
	},
});
// Comment "orphan" is on a post Reddit no longer returns.
const thing = (name) => {
	if (name === "t5_test") return community;
	if (name.startsWith("t1_")) return comment(name.slice(3), name === "t1_orphan" ? "gone" : "a");
	return post(name.slice(3));
};

// /api/info answers every name except those of "gone"; a batch with
// "broken" fails.
globalThis.fetch = async (input) => {
	const url = new URL(input);
	fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify({ path: url.pathname, params: Object.fromEntries(url.searchParams) })}\n`);
	if (url.pathname === "/api/info.json") {
		const names = url.searchParams.get("id").split(",");
		if (names.includes("t3_broken")) return new Response("<html>unavailable</html>", { status: 503 });
		return Response.json(listing(names.filter((name) => !name.endsWith("_gone")).map(thing).reverse()));
	}
	if (url.pathname === "/r/test/hot.json") return Response.json(listing([post("a"), post("b")]));
	if (url.pathname === "/r/test/about.json") return Response.json({ data: community.data });
	if (url.pathname === "/comments/a.json") return Response.json([listing([post("a")]), listing([comment("c1", "a")])]);
	throw new Error(`Unexpected upstream request: ${url.pathname}`);
};
require("../index");

// Isolated Reddit fixture for saved posts: a feed, a discussion, and
// /api/info for the saved page.
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

// /api/info answers every id except "gone"; a batch with "broken" fails.
globalThis.fetch = async (input) => {
	const url = new URL(input);
	fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify({ path: url.pathname, params: Object.fromEntries(url.searchParams) })}\n`);
	if (url.pathname === "/api/info.json") {
		const names = url.searchParams.get("id").split(",");
		if (names.includes("t3_broken")) return new Response("<html>unavailable</html>", { status: 503 });
		return Response.json(
			listing(
				names
					.filter((name) => name !== "t3_gone")
					.map((name) => (name === "t5_test" ? community : post(name.slice(3))))
					.reverse(),
			),
		);
	}
	if (url.pathname === "/r/test/hot.json") return Response.json(listing([post("a"), post("b")]));
	if (url.pathname === "/r/test/about.json") return Response.json({ data: community.data });
	if (url.pathname === "/comments/a.json") return Response.json([listing([post("a")]), listing([])]);
	throw new Error(`Unexpected upstream request: ${url.pathname}`);
};
require("../index");

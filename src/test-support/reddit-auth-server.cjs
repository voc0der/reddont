const fs = require("node:fs");
const path = require("node:path");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".reddit-auth-test")) || fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("Reddit auth tests require a marked, empty temporary directory");
}
const { db } = require("../db");
for (const username of ["owner", "reader", "second_owner"]) {
	db.query("INSERT INTO users (username, apiKey) VALUES (?, ?)").run(username, `reddont_${username}`);
}
db.query("INSERT INTO subscriptions (user_id, subreddit) VALUES (2, 'test')").run();
const post = {
	kind: "t3",
	data: {
		id: "post1", name: "t3_post1", author: "poster", title: "Authenticated feed",
		subreddit: "test", created: Date.now() / 1000 - 60, created_utc: Date.now() / 1000 - 60,
		num_comments: 1, score: 10, ups: 10, is_self: true, domain: "self.test",
		permalink: "/r/test/comments/post1/discussion/",
		url: "https://www.reddit.com/r/test/comments/post1/discussion/",
	},
};
globalThis.fetch = async (input, options) => {
	const url = new URL(input);
	const headers = options?.headers || {};
	fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify({ path: url.pathname, headers })}\n`);
	if (url.pathname.startsWith("/r/broken/")) return new Response("Unavailable", { status: 503 });
	if (url.pathname.startsWith("/r/empty/")) return Response.json({ data: { children: [], after: null } });
	if (!headers.Cookie && !headers.Authorization) return new Response("Blocked", { status: 403 });
	if (url.searchParams.has("after")) return new Response("Blocked", { status: 403 });
	if (url.pathname === "/subreddits/search.json") return Response.json({ data: { children: [], after: null } });
	if (url.pathname.endsWith("/about.json")) return Response.json({ data: { display_name: "test", subscribers: 42 } });
	if (url.pathname.startsWith("/comments/")) return Response.json([{ data: { children: [post] } }, { data: { children: [] } }]);
	return Response.json({ data: { children: [post], after: null } });
};
require("../index");

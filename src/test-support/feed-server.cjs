// Isolated upstream fixture for feed paging and browser regression checks.
const fs = require("node:fs");
const path = require("node:path");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".feed-test")) || fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("Feed tests require a marked, empty temporary data directory");
}
const { db } = require("../db");
db.query("INSERT INTO users (username, infiniteScroll, redditAuthHeaders) VALUES (?, 1, ?)")
	.run("reader_scroll", JSON.stringify({ authorization: "Bearer feed-test" }));

const PAGE_SIZE = 20;
const PAGES = 5;
const post = (index) => ({
	kind: "t3",
	data: {
		id: `p${index}`, name: `t3_p${index}`, author: `poster_${index}`, subreddit: "test",
		title: `Post number ${index}`, created: 1780000000 - index * 60, num_comments: 2,
		score: 100 - index, ups: 100 - index, is_self: true, domain: "self.test",
		selftext_html: `&lt;div class="md"&gt;&lt;p&gt;Body ${index}&lt;/p&gt;&lt;/div&gt;`,
		permalink: `/r/test/comments/p${index}/post/`,
		url: `https://www.reddit.com/r/test/comments/p${index}/post/`,
	},
});
// A fresh request for the first page sees a new post on top, as a busy hot
// listing would, so restoring an old page can be told apart from reloading it.
let firstPageLoads = 0;
globalThis.fetch = async (input) => {
	const url = new URL(input);
	fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify({ path: url.pathname, params: Object.fromEntries(url.searchParams) })}\n`);
	if (url.pathname === "/r/test/about.json") {
		return Response.json({ data: { display_name: "test", subscribers: 1200, public_description: "Feed fixture" } });
	}
	if (/^\/r\/test\/[a-z]+\.json$/.test(url.pathname)) {
		const after = url.searchParams.get("after");
		const page = after ? Number(after.replace("t3_page", "")) : 0;
		if (!after) firstPageLoads++;
		const start = page * PAGE_SIZE + 1;
		const children = Array.from({ length: PAGE_SIZE }, (_, i) => post(start + i));
		if (!after && firstPageLoads > 1) children.unshift(post(1000 + firstPageLoads));
		return Response.json({ kind: "Listing", data: { after: page + 1 < PAGES ? `t3_page${page + 1}` : null, children } });
	}
	if (url.pathname.startsWith("/comments/")) {
		const id = url.pathname.match(/^\/comments\/([a-z0-9]+)/)[1];
		return Response.json([{ data: { children: [post(Number(id.slice(1)))] } }, { data: { children: [] } }]);
	}
	throw new Error(`Unexpected upstream request: ${url.pathname}`);
};
require("../index");

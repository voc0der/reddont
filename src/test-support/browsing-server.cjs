// Isolated Reddit fixture for subscription, search, and media page checks.
const fs = require("node:fs");
const path = require("node:path");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".browsing-test")) || fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("Browsing tests require a marked, empty temporary data directory");
}
const { db } = require("../db");
db.query("INSERT INTO users (username) VALUES ('browser')").run();

const now = Date.now() / 1000;
const listing = (children) => ({ kind: "Listing", data: { after: null, children } });
const community = (name) => ({ kind: "t5", data: { display_name: name, public_description: `About ${name}`, subscribers: 1200 } });
const post = (id) => ({
	kind: "t3",
	data: {
		id, name: `t3_${id}`, author: "poster", subreddit: "test", title: `Result ${id}`,
		created: now - 60, created_utc: now - 60, num_comments: 0, score: 1, ups: 1,
		is_self: true, domain: "self.test", permalink: `/r/test/comments/${id}/result/`,
		url: `https://www.reddit.com/r/test/comments/${id}/result/`,
	},
});

// Searches for "nothing" find no results, and searches for "broken" fail.
globalThis.fetch = async (input) => {
	const url = new URL(input);
	const q = url.searchParams.get("q");
	fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify({ path: url.pathname, params: Object.fromEntries(url.searchParams) })}\n`);
	if (q === "broken") return new Response("<html>unavailable</html>", { status: 503 });
	if (url.pathname === "/subreddits/search.json") {
		return Response.json(listing(q === "nothing" ? [] : [community("test"), community("Other")]));
	}
	if (url.pathname === "/search.json") return Response.json(listing(q === "nothing" ? [] : [post("found")]));
	if (url.pathname === "/r/test/about.json") {
		return Response.json({
			data: {
				display_name: "test",
				subscribers: 1200,
				description_html: "&lt;div class=\"md\"&gt;&lt;p&gt;Wrap code in &amp;lt;code&amp;gt; tags&lt;/p&gt;&lt;/div&gt;",
			},
		});
	}
	if (url.pathname === "/r/test/hot.json") return Response.json(listing([post("feed")]));
	throw new Error(`Unexpected upstream request: ${url.pathname}`);
};
require("../index");

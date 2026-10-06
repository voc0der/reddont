// Isolated upstream fixture for comment route and browser regression checks.
const fs = require("node:fs");
const path = require("node:path");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".comments-test")) || fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("Comment tests require a marked, empty temporary data directory");
}
const { db } = require("../db");
for (const theme of ["res", "light", "dark"]) {
	db.query("INSERT INTO users (username, themePreference, redditAuthHeaders) VALUES (?, ?, ?)")
		.run(`reader_${theme}`, theme, JSON.stringify({ authorization: "Bearer comments-test" }));
}
for (const theme of ["res", "light", "dark"]) {
	db.query("INSERT INTO users (username, themePreference, infiniteScroll, redditAuthHeaders) VALUES (?, ?, 1, ?)")
		.run(`reader_auto_${theme}`, theme, JSON.stringify({ authorization: "Bearer comments-test" }));
}

const comment = (id, parent_id = "t3_post1", replies = []) => ({
	kind: "t1",
	data: {
		id, name: `t1_${id}`, parent_id, author: `reader_${id}`, score: 3, ups: 3,
		created: 1780000000, edited: false,
		body_html: `&lt;div class="md"&gt;&lt;p&gt;Comment ${id}: &amp;lt;script&amp;gt; stays text.&lt;/p&gt;&lt;/div&gt;`,
		permalink: `/r/test/comments/post1/discussion/${id}/`,
		replies: replies.length ? { kind: "Listing", data: { children: replies } } : "",
	},
});
const more = (children, parent_id = "t3_post1") => ({
	kind: "more", data: { id: children[0] || "_", parent_id, children, count: children.length },
});
const post = {
	kind: "t3", data: {
		id: "post1", author: "poster", title: "A long discussion", subreddit: "test",
		created: 1780000000, num_comments: 210, score: 10, ups: 10, is_self: true,
		domain: "self.test", permalink: "/r/test/comments/post1/discussion/",
		url: "https://www.reddit.com/r/test/comments/post1/discussion/",
	},
};
let failed = false;
globalThis.fetch = async (input, options) => {
	const url = new URL(input);
	fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify({ path: url.pathname, params: Object.fromEntries(url.searchParams), authenticated: options?.headers?.Authorization === "Bearer comments-test" })}\n`);
	if (url.pathname === "/api/morechildren.json") {
		const ids = url.searchParams.get("children").split(",");
		if (ids.length > 100 || url.searchParams.get("link_id") !== "t3_post1") throw new Error("Invalid batch");
		if (ids[0] === "failure" && !failed) {
			failed = true;
			return new Response("Try again", { status: 503 });
		}
		const things = ids.filter((id) => id !== "gone").map((id) => comment(id, id.startsWith("reply") ? "t1_existing" : "t3_post1"));
		if (ids.includes("c0")) {
			things.unshift(comment("grandchild", "t1_child"), comment("child", "t1_c0"));
			things.push(more([], "t1_grandchild"));
		}
		return Response.json({ json: { errors: [], data: { things } } });
	}
	if (url.pathname.startsWith("/comments/")) {
		const child = url.pathname.match(/\/comment\/([a-z0-9]+)\.json$/)?.[1];
		const comments = child ? [comment(child)] : [
			comment("existing", "t3_post1", [more(["reply1", "reply2"], "t1_existing")]),
			more(Array.from({ length: 205 }, (_, i) => `c${i}`)),
		];
		return Response.json([{ data: { children: [post] } }, { data: { children: comments } }]);
	}
	throw new Error(`Unexpected upstream request: ${url.pathname}`);
};
require("../index");

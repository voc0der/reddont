const fs = require("node:fs");
const path = require("node:path");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".recent-feed-test")) || fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("Recent feed tests require a marked, empty temporary directory");
}

const { db } = require("../db");
for (const [index, theme] of ["res", "light", "dark"].entries()) {
	for (const infiniteScroll of [0, 1]) {
		const id = index * 2 + infiniteScroll + 1;
		db.query("INSERT INTO users (id, username, themePreference, infiniteScroll, redditAuthHeaders) VALUES (?, ?, ?, ?, ?)")
			.run(id, `reader_${theme}_${infiniteScroll}`, theme, infiniteScroll, JSON.stringify({ authorization: "Bearer recent-feed-fixture" }));
		for (const sub of ["test", "other"]) {
			db.query("INSERT INTO subscriptions (user_id, subreddit) VALUES (?, ?)").run(id, sub);
		}
	}
}
db.query("INSERT INTO users (id, username, redditAuthHeaders) VALUES (7, 'unsubscribed', ?)")
	.run(JSON.stringify({ authorization: "Bearer recent-feed-fixture" }));
db.query("INSERT INTO users (id, username, redditAuthHeaders) VALUES (8, 'sparse', ?)")
	.run(JSON.stringify({ authorization: "Bearer sparse-feed-fixture" }));

const now = Date.now() / 1000;
function post(id, age, extra = {}) {
	return {
		kind: "t3",
		data: {
			id, name: `t3_${id}`, author: "poster", subreddit: "test", title: `Feed post ${id}`,
			created: now - age, created_utc: now - age, num_comments: 2, score: 40, ups: 40,
			is_self: true, domain: "self.test", permalink: `/r/test/comments/${id}/post/`,
			url: `https://www.reddit.com/r/test/comments/${id}/post/`, ...extra,
		},
	};
}

// Vary age and score independently of the upstream order. Local sorting would
// change the expected sequence, even though all these posts are recent.
const fresh = Array.from({ length: 60 }, (_, i) => post(`recent${i}`, 60 + (i % 7) * 3600, { score: (i % 5) * 100 }));
const stale = (i) => post(`expired${i}`, 8 * 86400);
globalThis.fetch = async (input, options) => {
	const url = new URL(input);
	fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify({ path: url.pathname, params: Object.fromEntries(url.searchParams), authorization: options?.headers?.Authorization })}\n`);
	if (url.pathname.endsWith("/about.json")) {
		return Response.json({ data: { display_name: "test", subscribers: 1200, public_description: "Feed tests" } });
	}
	const sort = url.pathname.match(/\/(hot|new|rising|controversial|top)\.json$/)?.[1];
	if (!sort) throw new Error(`Unexpected fixture request: ${url.pathname}`);
	let source = [post("oldpin", 20 * 86400, { stickied: true })];
	if (options?.headers?.Authorization === "Bearer sparse-feed-fixture" || url.pathname.startsWith("/r/sparse/")) {
		source = source.concat(Array.from({ length: 150 }, (_, i) => stale(i)), fresh);
	} else if (url.pathname.startsWith("/r/quiet/")) {
		source = source.concat(Array.from({ length: 40 }, (_, i) => stale(i)));
	} else if (url.pathname.startsWith("/r/gap/")) {
		source = source.concat(fresh.slice(0, 25), Array.from({ length: 150 }, (_, i) => stale(i)), fresh.slice(25));
	} else if (sort === "new") {
		source = source.concat(fresh.map((p, i) => ({ ...p, data: { ...p.data, created_utc: now - 60 - i * 3600 } })), stale(0));
	} else {
		source = source.concat(fresh.flatMap((p, i) => [stale(i), p]));
	}
	// These two native sorts honor time ranges. Catch an accidental week
	// request that would still hide a quiet community upstream.
	if (["top", "controversial"].includes(sort)) {
		const seconds = { hour: 3600, day: 86400, week: 7 * 86400, month: 30 * 86400, year: 365 * 86400 }[url.searchParams.get("t")];
		if (seconds) source = source.filter((p) => p.data.created_utc >= now - seconds);
	}
	const after = url.searchParams.get("after");
	const start = after ? source.findIndex((p) => p.data.name === after) + 1 : 0;
	const limit = Number(url.searchParams.get("limit")) || 25;
	const children = source.slice(start, start + limit);
	return Response.json({ data: { children, after: start + children.length < source.length ? children.at(-1)?.data.name : null } });
};
require("../index");

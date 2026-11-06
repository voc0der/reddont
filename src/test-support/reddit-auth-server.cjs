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
	fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify({ host: url.hostname, path: url.pathname, headers })}\n`);
	// OAuth apps get a token named after them; apps ending in "-refused" don't.
	if (url.pathname === "/api/v1/access_token") {
		const app = atob(String(headers.Authorization).replace(/^Basic /, "")).replace(/:$/, "");
		return app.endsWith("-refused")
			? Response.json({ message: "Unauthorized", error: 401 }, { status: 401 })
			: Response.json({ access_token: `token-for-${app}`, token_type: "bearer", expires_in: 86400, scope: "*" });
	}
	// Cookie feeds and searches read old reddit's page, then load its posts
	// from /api/info.api. oauth.reddit.com serves JSON without an extension.
	const listing = (children) =>
		/\.(json|api)$/.test(url.pathname) || url.hostname === "oauth.reddit.com"
			? Response.json({ data: { children, after: null } })
			: new Response(
					`<div id="siteTable">${children.map(({ data }) => `<div class="thing" data-fullname="${data.name}"></div>`).join("")}</div>`,
					{ headers: { "content-type": "text/html; charset=UTF-8" } },
				);
	if (url.pathname.startsWith("/r/broken/")) return new Response("Unavailable", { status: 503 });
	if (url.pathname.startsWith("/r/empty/")) return listing([]);
	// Communities Reddit blocks for cookies only, or for tokens only.
	if (url.pathname.startsWith("/r/cookieblocked/") && headers.Cookie) return new Response("Blocked", { status: 403 });
	if (url.pathname.startsWith("/r/oauthblocked/") && headers.Authorization) return new Response("Blocked", { status: 403 });
	if (!headers.Cookie && !headers.Authorization) return new Response("Blocked", { status: 403 });
	if (url.searchParams.has("after")) return new Response("Blocked", { status: 403 });
	if (/^\/subreddits\/search(\.json)?$/.test(url.pathname)) return listing([]);
	if (/\/about(\.json)?$/.test(url.pathname)) return Response.json({ data: { display_name: "test", subscribers: 42 } });
	if (url.pathname.startsWith("/comments/")) return Response.json([{ data: { children: [post] } }, { data: { children: [] } }]);
	return listing([post]);
};
require("../index");

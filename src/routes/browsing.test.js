const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const { Database } = require("bun:sqlite");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { startServer } = require("../test-support/server.cjs");

// The tests run in order and share one reader's subscriptions.
const secret = "isolated-browsing-test-secret";
const csrf = "isolated-csrf-token-for-browsing-tests";
const realFetch = globalThis.fetch;
let server;
let db;
let session;

beforeAll(async () => {
	server = await startServer("browsing-server.cjs", "browsing-test", { JWT_SECRET_KEY: secret });
	db = new Database(path.join(server.dataDir, "reddont.db"), { readonly: true });
	session = `auth_token=${jwt.sign({ id: 1, username: "browser" }, secret, { expiresIn: "1h" })}`;
}, 15000);

afterAll(async () => {
	db?.close();
	await server?.stop();
});

function get(route, cookie = session) {
	return realFetch(server.baseUrl + route, { headers: { Cookie: cookie }, redirect: "manual" });
}

// Subscription buttons post JSON with the CSRF token in a header.
function post(route, body) {
	return realFetch(server.baseUrl + route, {
		method: "POST",
		headers: { Cookie: `${session}; csrf_token=${csrf}`, "X-CSRF-Token": csrf, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

function subscriptions() {
	return db.query("SELECT subreddit FROM subscriptions ORDER BY subreddit").all().map((row) => row.subreddit);
}

describe("subscriptions", () => {
	test("subscribing adds a community once", async () => {
		const response = await post("/subscribe", { subreddit: "r/Test" });
		expect(response.status).toBe(201);
		expect(await response.text()).toBe("Subscribed successfully");
		expect(subscriptions()).toEqual(["Test"]);

		const repeat = await post("/subscribe", { subreddit: "Test" });
		expect(repeat.status).toBe(400);
		expect(await repeat.text()).toBe("Already subscribed to this subreddit");
	});

	test("rejects names that are not a single community", async () => {
		for (const subreddit of ["not a sub", "Test+Other", "", 42]) {
			for (const route of ["/subscribe", "/unsubscribe"]) {
				const response = await post(route, { subreddit });
				expect(response.status).toBe(400);
				expect(await response.text()).toBe("Invalid subreddit");
			}
		}
		expect(subscriptions()).toEqual(["Test"]);
	});

	test("bulk subscribing reports what was added, skipped, and rejected", async () => {
		const response = await post("/subscribe-bulk", { subreddits: ["Other", "Test", "bad name", "r/Third"] });
		expect(await response.json()).toEqual({ added: ["Other", "Third"], skipped: ["Test"], failed: ["bad name"] });
		expect(subscriptions()).toEqual(["Other", "Test", "Third"]);

		for (const subreddits of [[], "Test", undefined]) {
			const invalid = await post("/subscribe-bulk", { subreddits });
			expect(invalid.status).toBe(400);
			expect((await invalid.json()).error).toContain("non-empty array");
		}
	});

	test("the subscriptions page links each community", async () => {
		const html = await (await get("/subs?sort=new&view=card")).text();
		for (const subreddit of ["Other", "Test", "Third"]) {
			expect(html).toContain(`href="/r/${subreddit}?sort=new&amp;view=card"`);
		}
	});

	test("unsubscribing removes one community or all of them", async () => {
		const response = await post("/unsubscribe", { subreddit: "Third" });
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("Unsubscribed successfully");

		const missing = await post("/unsubscribe", { subreddit: "Third" });
		expect(missing.status).toBe(400);
		expect(await missing.text()).toBe("Subscription not found");

		expect(await (await post("/unsubscribe-all")).json()).toEqual({ message: "All subscriptions removed", count: 2 });
		expect(subscriptions()).toEqual([]);
		expect(await (await get("/subs")).text()).toContain("No subscriptions yet.");
	});
});

describe("search pages", () => {
	test("the search page offers community and post searches", async () => {
		const html = await (await get("/search")).text();
		expect(html).toContain('action="/sub-search"');
		expect(html).toContain('action="/post-search"');
	});

	test("community search marks the reader's subscriptions", async () => {
		await post("/subscribe", { subreddit: "Other" });
		expect(await (await get("/sub-search")).text()).not.toContain("search-results");

		const html = await (await get("/sub-search?q=gpu")).text();
		expect(html).toContain("showing 2 results");
		expect(html).toContain(`id="thinger_Other">unsubscribe</button>`);
		expect(html).toContain(`id="thinger_test">subscribe</button>`);
		expect(html).toContain("About test");

		expect(await (await get("/sub-search?q=nothing")).text()).toContain("no results found");
	});

	test("post search explains empty and failed searches", async () => {
		const found = await (await get("/post-search?q=gpu")).text();
		expect(found).toContain("showing 1 results");
		expect(found).toContain("Result found");
		expect(found).toContain("search within r/test");

		const empty = await (await get("/post-search")).text();
		expect(empty).not.toContain("search-message");
		expect(await (await get("/post-search?q=nothing")).text()).toContain("no results found");
		expect(await (await get("/post-search?q=broken")).text()).toContain("search failed, try again later");
	});
});

describe("pages", () => {
	test("community feeds decode the sidebar once, keeping quoted markup as text", async () => {
		const html = await (await get("/r/test")).text();
		expect(html).toContain('<div class="md"><p>Wrap code in &lt;code&gt; tags</p></div>');
	});

	test("media pages show images and videos", async () => {
		const image = await (await get("/media/https://i.redd.it/photo.JPG")).text();
		expect(image).toContain('<img class="media-maximized" src="https://i.redd.it/photo.JPG"');

		const video = await (await get("/media/https://v.redd.it/clip/DASH_720.mp4")).text();
		expect(video).toContain('<video class="media-maximized" src="https://v.redd.it/clip/DASH_720.mp4" controls');
	});

	test("the offline page needs no session", async () => {
		const response = await get("/offline", "");
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("You're Offline");
	});

	test("malformed identifiers are rejected before contacting Reddit", async () => {
		const before = server.requests().length;
		for (const [route, message] of [
			["/r/bad!name", "Invalid subreddit"],
			["/comments/bad!id", "Invalid submission id"],
			["/comments/post1/comment/bad!id", "Invalid comment thread identifiers"],
		]) {
			const response = await get(route);
			expect(response.status).toBe(400);
			expect(await response.text()).toBe(message);
		}
		const api = await get("/api/r/bad!name/posts");
		expect(api.status).toBe(400);
		expect(await api.json()).toEqual({ error: "Invalid subreddit" });
		expect(server.requests()).toHaveLength(before);
	});
});

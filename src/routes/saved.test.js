const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const { Database } = require("bun:sqlite");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { startServer, withFailingWrites } = require("../test-support/server.cjs");

// The tests run in order and share one reader's saved posts.
const secret = "isolated-saved-test-secret";
const csrf = "isolated-csrf-token-for-saved-tests";
const realFetch = globalThis.fetch;
let server;
let db;
let session;

beforeAll(async () => {
	server = await startServer("saved-server.cjs", "saved-test", { JWT_SECRET_KEY: secret });
	db = new Database(path.join(server.dataDir, "reddont.db"), { readonly: true });
	session = `auth_token=${jwt.sign({ id: 1, username: "saver" }, secret, { expiresIn: "1h" })}`;
}, 15000);

afterAll(async () => {
	db?.close();
	await server?.stop();
});

function get(route) {
	return realFetch(server.baseUrl + route, { headers: { Cookie: session }, redirect: "manual" });
}

async function page(route) {
	const response = await get(route);
	expect(response.status).toBe(200);
	return response.text();
}

// Save buttons post JSON with the CSRF token in a header.
function post(route, body) {
	return realFetch(server.baseUrl + route, {
		method: "POST",
		headers: { Cookie: `${session}; csrf_token=${csrf}`, "X-CSRF-Token": csrf, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

function savePreference(fields) {
	return realFetch(`${server.baseUrl}/update-preferences`, {
		method: "POST",
		headers: { Cookie: `${session}; csrf_token=${csrf}`, "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ _csrf: csrf, ...fields }),
		redirect: "manual",
	});
}

function savedIds() {
	return db.query("SELECT post_id FROM saved_posts ORDER BY id").all().map((row) => row.post_id);
}

// Each post has a desktop save link and a phone menu item: the ids in page
// order, once each.
function saveControls(html) {
	const controls = [...html.matchAll(/data-save-post="([^"]+)" data-saved="([01])"/g)].map(([, id, saved]) => `${id}:${saved}`);
	return controls.filter((control, index) => control !== controls[index - 1]);
}

describe("saved posts", () => {
	test("stay off until the reader turns them on", async () => {
		const feed = await page("/r/test");
		expect(feed).toContain("Post a");
		expect(saveControls(feed)).toEqual([]);
		expect(feed).not.toContain('href="/saved');

		for (const route of ["/save", "/unsave"]) {
			const response = await post(route, { id: "a" });
			expect(response.status).toBe(403);
			expect(await response.text()).toBe("Saved posts are turned off");
		}
		const saved = await get("/saved");
		expect(saved.status).toBe(302);
		expect(new URL(saved.headers.get("location"), server.baseUrl).searchParams.get("message")).toBe(
			"Saved posts are turned off. Turn them on in your preferences.",
		);
		expect(await page("/dashboard")).toContain('id="pref-save-posts" name="savePosts" value="1" aria-describedby="pref-save-posts-help"');
		expect(savedIds()).toEqual([]);
	});

	test("the preference adds save to posts and saved to the account links", async () => {
		const response = await savePreference({ savePosts: "1" });
		expect(response.headers.get("location")).toBe("/dashboard");
		expect(await page("/dashboard")).toContain('name="savePosts" value="1" checked aria-describedby');

		const feed = await page("/r/test?view=card");
		expect(saveControls(feed)).toEqual(["a:0", "b:0"]);
		expect(feed).toContain('data-save-label="save" data-saved-label="unsave" onclick="toggleSave(this)">save</button>');
		expect(feed).toContain('<span class="save-label">Save</span>');
		expect(feed).toMatch(/<a class="account-link" href="\/dashboard\?view=card">saver<\/a><span class="separator d-only" aria-hidden="true">\|<\/span><a class="d-only" href="\/saved\?view=card">saved<\/a>/);
		// The phone drawer and account menu link the page too.
		expect(feed.match(/href="\/saved\?view=card"/g)).toHaveLength(3);
	});

	test("saving and unsaving answer the same when repeated", async () => {
		for (const id of ["a", "a", "t3_B"]) {
			const response = await post("/save", { id });
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("Saved");
		}
		expect(savedIds()).toEqual(["a", "b"]);
		expect(saveControls(await page("/r/test"))).toEqual(["a:1", "b:1"]);
		expect(await page("/r/test")).toContain('<span class="save-label">Unsave</span>');

		for (let attempt = 0; attempt < 2; attempt++) {
			const response = await post("/unsave", { id: "b" });
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("Unsaved");
		}
		expect(savedIds()).toEqual(["a"]);
		expect(saveControls(await page("/r/test"))).toEqual(["a:1", "b:0"]);
	});

	test("rejects anything but a post id", async () => {
		for (const id of ["bad id", "t1_abc", "a".repeat(21), "", 42, undefined]) {
			for (const route of ["/save", "/unsave"]) {
				const response = await post(route, { id });
				expect(response.status).toBe(400);
				expect(await response.text()).toBe("Invalid post id");
			}
		}
		expect(savedIds()).toEqual(["a"]);
	});

	test("the discussion page saves its post too", async () => {
		expect(saveControls(await page("/comments/a"))).toEqual(["a:1"]);
	});

	test("the saved page lists the newest save first, 25 to a page", async () => {
		const ids = Array.from({ length: 26 }, (_, index) => `p${index + 1}`);
		for (const id of ids) await post("/save", { id });
		const requestsBefore = server.requests().length;

		const first = await page("/saved");
		expect(saveControls(first)).toEqual(ids.slice(1).reverse().map((id) => `${id}:1`));
		expect(first).toContain('<span class="rank d-only">1</span>');
		const infoRequests = server.requests().slice(requestsBefore);
		expect(infoRequests.map((request) => request.path)).toEqual(["/api/info.json", "/api/info.json"]);
		expect(infoRequests[1].params.id).toBe("t5_test");

		const next = first.match(/href="(\/saved\?[^"]+)"/g).at(-1).slice(6, -1).replaceAll("&amp;", "&");
		const nextUrl = new URL(next, server.baseUrl);
		expect(nextUrl.searchParams.get("count")).toBe("25");
		const second = await page(next);
		expect(saveControls(second)).toEqual(["p1:1", "a:1"]);
		expect(second).toContain('<span class="rank d-only">26</span>');
		expect(second).not.toContain("view more:");

		// Unsaving a post on the first page doesn't move the second.
		await post("/unsave", { id: "p26" });
		expect(saveControls(await page(next))).toEqual(["p1:1", "a:1"]);
	});

	test("a post Reddit no longer returns keeps its place and can be unsaved", async () => {
		await post("/save", { id: "gone" });
		const html = await page("/saved");
		expect(html).toContain("Reddit no longer returns this saved post.");
		expect(saveControls(html).slice(0, 2)).toEqual(["gone:1", "p25:1"]);
		expect(html).toContain('<a href="/comments/gone?view=compact">open it</a>');
		await post("/unsave", { id: "gone" });
	});

	test("Reddit refusing the saved posts shows the feed error", async () => {
		await post("/save", { id: "broken" });
		const response = await get("/saved");
		expect(response.status).toBe(502);
		const html = await response.text();
		expect(html).toContain("Saved posts unavailable");
		expect(html).toContain("Reddit couldn't load your saved posts,");
		await post("/unsave", { id: "broken" });
	});

	test("reports saves it could not write", async () => {
		await withFailingWrites(server.dataDir, "INSERT", "saved_posts", async () => {
			const response = await post("/save", { id: "unwritten" });
			expect(response.status).toBe(500);
			expect(await response.text()).toBe("Failed to save post");
		});
		await withFailingWrites(server.dataDir, "DELETE", "saved_posts", async () => {
			const response = await post("/unsave", { id: "a" });
			expect(response.status).toBe(500);
			expect(await response.text()).toBe("Failed to unsave post");
		});
		expect(savedIds()).not.toContain("unwritten");
		expect(savedIds()).toContain("a");
	});

	test("turning saving off hides saved posts without deleting them", async () => {
		const saves = savedIds();
		await savePreference({});
		expect(saveControls(await page("/r/test"))).toEqual([]);
		expect((await get("/saved")).status).toBe(302);
		expect(savedIds()).toEqual(saves);

		await savePreference({ savePosts: "1" });
		expect(saveControls(await page("/r/test"))).toEqual(["a:1", "b:0"]);
	});

	test("an empty saved page says how to save", async () => {
		for (const id of savedIds()) await post("/unsave", { id });
		const html = await page("/saved");
		expect(html).toContain("Nothing saved yet. Save a post and it shows up here.");
		expect(saveControls(html)).toEqual([]);
	});
});

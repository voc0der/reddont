const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const { Database } = require("bun:sqlite");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { startServer, withFailingWrites } = require("../test-support/server.cjs");

// The tests run in order and share one reader's saved posts and comments.
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

function savedNames() {
	return db.query("SELECT fullname FROM saved_things ORDER BY id").all().map((row) => row.fullname);
}

// Everything saveable has a desktop save link and a phone menu item: their
// names and states in page order, once each.
function saveControls(html) {
	const controls = [...html.matchAll(/data-save-name="([^"]+)" data-saved="([01])"/g)].map(([, name, saved]) => `${name}:${saved}`);
	return controls.filter((control, index) => control !== controls[index - 1]);
}

describe("saving", () => {
	test("stays off until the reader turns it on", async () => {
		const feed = await page("/r/test");
		expect(feed).toContain("Post a");
		expect(saveControls(feed)).toEqual([]);
		expect(feed).not.toContain('href="/saved');
		const discussion = await page("/comments/a");
		expect(discussion).toContain("Comment c1");
		expect(saveControls(discussion)).toEqual([]);

		for (const route of ["/save", "/unsave"]) {
			const response = await post(route, { id: "t3_a" });
			expect(response.status).toBe(403);
			expect(await response.text()).toBe("Saving is turned off");
		}
		const saved = await get("/saved");
		expect(saved.status).toBe(302);
		expect(new URL(saved.headers.get("location"), server.baseUrl).searchParams.get("message")).toBe(
			"Saving is turned off. Turn it on in your preferences.",
		);
		expect(await page("/dashboard")).toContain('id="pref-enable-saving" name="enableSaving" value="1" aria-describedby="pref-enable-saving-help"');
		expect(savedNames()).toEqual([]);
	});

	test("the preference adds save to posts and comments, and saved to the account links", async () => {
		const response = await savePreference({ enableSaving: "1" });
		expect(response.headers.get("location")).toBe("/dashboard");
		expect(await page("/dashboard")).toContain('name="enableSaving" value="1" checked aria-describedby');

		const feed = await page("/r/test?view=card");
		expect(saveControls(feed)).toEqual(["t3_a:0", "t3_b:0"]);
		expect(feed).toContain('data-save-label="save" data-saved-label="unsave" onclick="toggleSave(this)">save</button>');
		expect(feed).toContain('<span class="save-label">Save</span>');
		expect(feed).toMatch(/<a class="account-link" href="\/dashboard\?view=card">saver<\/a><span class="separator d-only" aria-hidden="true">\|<\/span><a class="d-only" href="\/saved\?view=card">saved<\/a>/);
		// The phone drawer and account menu link the page too.
		expect(feed.match(/href="\/saved\?view=card"/g)).toHaveLength(3);

		expect(saveControls(await page("/comments/a"))).toEqual(["t3_a:0", "t1_c1:0"]);
	});

	test("saving and unsaving answer the same when repeated", async () => {
		for (const id of ["t3_a", "T3_A", "t1_c1", " t3_b "]) {
			const response = await post("/save", { id });
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("Saved");
		}
		expect(savedNames()).toEqual(["t3_a", "t1_c1", "t3_b"]);
		const feed = await page("/r/test");
		expect(saveControls(feed)).toEqual(["t3_a:1", "t3_b:1"]);
		expect(feed).toContain('<span class="save-label">Unsave</span>');
		expect(saveControls(await page("/comments/a"))).toEqual(["t3_a:1", "t1_c1:1"]);

		for (let attempt = 0; attempt < 2; attempt++) {
			const response = await post("/unsave", { id: "t3_b" });
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("Unsaved");
		}
		expect(savedNames()).toEqual(["t3_a", "t1_c1"]);
		expect(saveControls(await page("/r/test"))).toEqual(["t3_a:1", "t3_b:0"]);
	});

	test("rejects anything but a post's or comment's fullname", async () => {
		for (const id of ["a", "bad id", "t5_test", "t2_user", "t3_", `t3_${"a".repeat(21)}`, "t3_a/../b", "", 42, undefined]) {
			for (const route of ["/save", "/unsave"]) {
				const response = await post(route, { id });
				expect(response.status).toBe(400);
				expect(await response.text()).toBe("Invalid post or comment");
			}
		}
		expect(savedNames()).toEqual(["t3_a", "t1_c1"]);
	});

	test("the saved page lists the newest save first, 25 to a page", async () => {
		const ids = Array.from({ length: 25 }, (_, index) => `p${index + 1}`);
		for (const id of ids) await post("/save", { id: `t3_${id}` });
		const requestsBefore = server.requests().length;

		const first = await page("/saved");
		expect(saveControls(first)).toEqual(ids.slice().reverse().map((id) => `t3_${id}:1`));
		expect(first).toContain('<span class="rank d-only">1</span>');
		// The saves, then the community of the posts.
		const infoRequests = server.requests().slice(requestsBefore);
		expect(infoRequests.map((request) => request.path)).toEqual(["/api/info.json", "/api/info.json"]);
		expect(infoRequests[1].params.id).toBe("t5_test");

		const next = first.match(/href="(\/saved\?[^"]+)"/g).at(-1).slice(6, -1).replaceAll("&amp;", "&");
		expect(new URL(next, server.baseUrl).searchParams.get("count")).toBe("25");
		const second = await page(next);
		expect(saveControls(second)).toEqual(["t1_c1:1", "t3_a:1"]);
		expect(second).toContain('<span class="rank d-only">27</span>');
		expect(second).not.toContain("view more:");

		// Unsaving on the first page doesn't move the second.
		await post("/unsave", { id: "t3_p25" });
		expect(saveControls(await page(next))).toEqual(["t1_c1:1", "t3_a:1"]);
	});

	test("a saved comment shows under the post it's on, with its usual buttons", async () => {
		await post("/save", { id: "t1_orphan" });
		// Saved again after unsaving, c1 moves to the top.
		await post("/unsave", { id: "t1_c1" });
		await post("/save", { id: "t1_c1" });
		const requestsBefore = server.requests().length;
		const html = await page("/saved");

		// One request for the saves, one for the comments' posts and the
		// posts' community together.
		const infoRequests = server.requests().slice(requestsBefore);
		expect(infoRequests).toHaveLength(2);
		expect(infoRequests[1].params.id.split(",").sort()).toEqual(["t3_a", "t3_gone", "t5_test"]);

		expect(saveControls(html).slice(0, 3)).toEqual(["t1_c1:1", "t1_orphan:1", "t3_p24:1"]);
		expect(html).toContain('<a class="saved-comment-title" href="/comments/a?view=compact">Post a</a>');
		expect(html).toContain('<a class="saved-comment-title" href="/comments/gone?view=compact">a post</a>');
		expect(html).toContain("<p>Comment orphan: &lt;b&gt; stays text.</p>");
		expect(html).toContain('<a href="/comments/gone/comment/orphan">permalink</a>');
		expect(html).toContain('<a href="/comments/a/comment/c1">permalink</a>');
	});

	test("what Reddit no longer returns keeps its place and can be unsaved", async () => {
		await post("/save", { id: "t3_gone" });
		await post("/save", { id: "t1_gone" });
		const html = await page("/saved");
		expect(saveControls(html).slice(0, 3)).toEqual(["t1_gone:1", "t3_gone:1", "t1_c1:1"]);
		expect(html).not.toContain("/comments/gone/comment/gone");
		expect(html).toContain("Reddit no longer returns this saved comment.");
		expect(html).toContain("Reddit no longer returns this saved post.");
		expect(html).toContain('<a href="/comments/gone?view=compact">open it</a>');
		await post("/unsave", { id: "t3_gone" });
		await post("/unsave", { id: "t1_gone" });
	});

	test("Reddit refusing the saved things shows the feed error", async () => {
		await post("/save", { id: "t3_broken" });
		const response = await get("/saved");
		expect(response.status).toBe(502);
		const html = await response.text();
		expect(html).toContain("Saved posts and comments unavailable");
		expect(html).toContain("Reddit couldn't load your saved posts and comments,");
		await post("/unsave", { id: "t3_broken" });
	});

	test("reports saves it could not write", async () => {
		await withFailingWrites(server.dataDir, "INSERT", "saved_things", async () => {
			const response = await post("/save", { id: "t3_unwritten" });
			expect(response.status).toBe(500);
			expect(await response.text()).toBe("Failed to save");
		});
		await withFailingWrites(server.dataDir, "DELETE", "saved_things", async () => {
			const response = await post("/unsave", { id: "t3_a" });
			expect(response.status).toBe(500);
			expect(await response.text()).toBe("Failed to unsave");
		});
		expect(savedNames()).not.toContain("t3_unwritten");
		expect(savedNames()).toContain("t3_a");
	});

	test("turning saving off hides what was saved without deleting it", async () => {
		const saves = savedNames();
		await savePreference({});
		expect(saveControls(await page("/r/test"))).toEqual([]);
		expect(saveControls(await page("/comments/a"))).toEqual([]);
		expect((await get("/saved")).status).toBe(302);
		expect(savedNames()).toEqual(saves);

		await savePreference({ enableSaving: "1" });
		expect(saveControls(await page("/comments/a"))).toEqual(["t3_a:1", "t1_c1:1"]);
	});

	test("an empty saved page says how to save", async () => {
		for (const id of savedNames()) await post("/unsave", { id });
		const html = await page("/saved");
		expect(html).toContain("Nothing saved yet. Save a post or comment and it shows up here.");
		expect(saveControls(html)).toEqual([]);
	});
});

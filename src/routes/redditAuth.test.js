const { afterAll, beforeAll, beforeEach, describe, expect, test } = require("bun:test");
const { Database } = require("bun:sqlite");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-auth-"));
const secret = "isolated-reddit-auth-test-secret";
const csrf = "isolated-csrf-token-for-reddit-auth-tests";
const realFetch = globalThis.fetch;
let server;
let baseUrl;
let db;

beforeAll(async () => {
	fs.writeFileSync(path.join(dataDir, ".reddit-auth-test"), "Disposable test data");
	server = spawn(process.execPath, ["run", "--no-env-file", path.resolve("src/test-support/reddit-auth-server.cjs")], {
		env: {
			PATH: process.env.PATH, REDDONT_DATA_DIR: dataDir,
			REDDONT_PORT: "0", HTTP_BINDING: "127.0.0.1", JWT_SECRET_KEY: secret,
			REDDONT_DISABLE_SSL: "true", LOG_LEVEL: "info", RATE_LIMIT: "1000",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	baseUrl = await new Promise((resolve, reject) => {
		let log = "";
		const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${log}`)), 10000);
		const read = (chunk) => {
			log += chunk;
			const match = log.match(/HTTP server started on port (\d+)/);
			if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
		};
		server.stdout.on("data", read);
		server.stderr.on("data", read);
		server.once("error", (error) => { clearTimeout(timeout); reject(error); });
		server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${log}`)); });
	});
	db = new Database(path.join(dataDir, "reddont.db"));
}, 15000);

beforeEach(() => {
	db.query("UPDATE users SET redditAuthHeaders = NULL, shareRedditCookie = 0").run();
	fs.writeFileSync(path.join(dataDir, "requests.jsonl"), "");
});

afterAll(async () => {
	db?.close();
	if (server && server.exitCode === null) {
		const exited = new Promise((resolve) => server.once("exit", resolve));
		server.kill();
		await exited;
	}
	fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(route, id = 2, fields) {
	const token = jwt.sign({ id }, secret, { expiresIn: "1h" });
	return realFetch(baseUrl + route, {
		method: fields ? "POST" : "GET",
		headers: { Cookie: `auth_token=${token}; csrf_token=${csrf}` },
		body: fields ? new URLSearchParams({ _csrf: csrf, ...fields }) : undefined,
		redirect: "manual",
	});
}

function credential(id, headers, shared = 0) {
	db.query("UPDATE users SET redditAuthHeaders = ?, shareRedditCookie = ? WHERE id = ?")
		.run(headers === null ? null : JSON.stringify(headers), shared, id);
}

function requests() {
	return fs.readFileSync(path.join(dataDir, "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

describe("feed authentication landing page", () => {
	test("links home, community, and multi feeds to the authentication settings", async () => {
		for (const route of ["/", "/r/all", "/r/test+other?sort=new"]) {
			const response = await request(route);
			const html = await response.text();
			expect(response.status).toBe(502);
			expect(html).toContain("Feed unavailable");
			expect(html).toContain("Add Reddit authentication");
			expect(html).toContain('href="/dashboard#reddit-authentication"');
			expect(html).toContain(`href="${route}"`);
		}
	});

	test("preserves successful empty listings", async () => {
		const response = await request("/r/empty");
		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain("Feed unavailable");
	});

	test("does not claim authentication is missing when a credential was used", async () => {
		for (const shared of [false, true]) {
			credential(2, shared ? null : { authorization: "Bearer personal" });
			credential(1, { cookie: "reddit_session=shared-secret" }, shared ? 1 : 0);
			const response = await request("/r/broken");
			const html = await response.text();
			expect(response.status).toBe(502);
			expect(html).toContain("Check Reddit authentication");
			expect(html).not.toContain("no Reddit authentication");
			expect(html).not.toContain("shared-secret");
		}
	});

	test("returns actionable pagination errors with safe retry links", async () => {
		const response = await request("/api/r/home/posts?after=t3_next&currentUrl=%2Fr%2Ftest%3Fsort%3Dnew");
		expect(response.status).toBe(502);
		const body = await response.json();
		expect(body.error).toBe("upstream_error");
		expect(body.after).toBeNull();
		expect(body.html).toContain("Add Reddit authentication");
		expect(body.html).toContain('href="/r/test?sort=new"');
		const unsafe = await request("/api/r/test/posts?currentUrl=//example.com");
		expect((await unsafe.json()).html).not.toContain("example.com");
	});
});

describe("shared Reddit cookies", () => {
	test("new accounts default to private credentials and only explicit sharing is used", async () => {
		const result = db.query("INSERT INTO users (username) VALUES ('new_reader')").run();
		expect(db.query("SELECT shareRedditCookie FROM users WHERE id = ?").get(result.lastInsertRowid).shareRedditCookie).toBe(0);
		credential(1, { cookie: "reddit_session=private-secret" });
		expect((await request("/r/test")).status).toBe(502);
		expect(requests().every(({ headers }) => !headers.Cookie)).toBe(true);
	});

	test("uses shared cookies across browser and API surfaces without exposing values", async () => {
		credential(1, { cookie: "reddit_session=shared-secret", authorization: "Bearer private-token" }, 1);
		for (const route of ["/", "/r/test", "/api/r/test/posts", "/comments/post1", "/post-search?q=test"]) {
			const response = await request(route);
			const text = await response.text();
			expect(response.status, `${route}: ${text.slice(-1500)}`).toBe(200);
			expect(text).not.toContain("shared-secret");
			expect(text).not.toContain("private-token");
		}
		const api = await realFetch(`${baseUrl}/api/v1/r/test/new.json`, { headers: { "X-API-Key": "reddont_reader" } });
		expect(api.status).toBe(200);
		expect(await api.text()).not.toContain("shared-secret");
		for (const { headers } of requests()) {
			expect(headers.Cookie).toBe("reddit_session=shared-secret");
			expect(headers.Authorization).toBeUndefined();
		}
		const dashboard = await (await request("/dashboard")).text();
		expect(dashboard).toContain("A shared cookie is being used");
		expect(dashboard).not.toContain("shared-secret");
	});

	test("keeps personal cookies and bearer tokens ahead of shared cookies", async () => {
		credential(1, { cookie: "reddit_session=shared-secret" }, 1);
		for (const own of [{ cookie: "reddit_session=personal" }, { authorization: "Bearer personal" }]) {
			credential(2, own);
			fs.writeFileSync(path.join(dataDir, "requests.jsonl"), "");
			expect((await request("/r/test")).status).toBe(200);
			for (const { headers } of requests()) {
				expect(headers.Cookie).toBe(own.cookie);
				expect(headers.Authorization).toBe(own.authorization);
			}
		}
	});

	test("skips unusable donors and chooses shared accounts in a stable order", async () => {
		credential(3, { cookie: "reddit_session=second" }, 1);
		for (const first of [null, { authorization: "Bearer token" }, { cookie: "invalid" }]) {
			credential(1, first, 1);
			await request("/r/test");
			expect(requests().at(-1).headers.Cookie).toBe("reddit_session=second");
		}
		credential(1, { cookie: "reddit_session=first" }, 1);
		await request("/r/test");
		expect(requests().at(-1).headers.Cookie).toBe("reddit_session=first");
	});

	test("does not use a shared cookie for a user with an invalid saved credential", async () => {
		credential(1, { cookie: "reddit_session=shared-secret" }, 1);
		credential(2, { cookie: "invalid" });
		expect((await request("/r/test")).status).toBe(502);
		expect(requests().every(({ headers }) => !headers.Cookie)).toBe(true);
	});

	test("does not grant anonymous visitors instance access", async () => {
		credential(1, { cookie: "reddit_session=shared-secret" }, 1);
		const response = await realFetch(baseUrl + "/r/test", { redirect: "manual" });
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toStartWith("/login?");
		expect(requests()).toEqual([]);
	});
});

describe("cookie sharing preferences", () => {
	test("saves the checkbox, preserves blank credentials, and revokes sharing immediately", async () => {
		const fields = { redditAuthCredential: "reddit_session=shared-secret", redditAuthType: "cookie", shareRedditCookie: "1" };
		expect((await request("/update-preferences", 1, fields)).status).toBe(302);
		expect((await request("/r/test")).status).toBe(200);
		let html = await (await request("/dashboard", 1)).text();
		expect(html).toMatch(/id="share-reddit-cookie"[^>]*checked/);
		expect(html).not.toContain("shared-secret");
		await request("/update-preferences", 1, { shareRedditCookie: "1", redditAuthCredential: "" });
		expect((await request("/r/test")).status).toBe(200);
		await request("/update-preferences", 1, {});
		expect((await request("/r/test")).status).toBe(502);
		expect((await request("/r/test", 1)).status).toBe(200);
		html = await (await request("/dashboard", 1)).text();
		expect(html).not.toMatch(/id="share-reddit-cookie"[^>]*checked/);
	});

	test("clearing a credential and replacing it with a bearer token both stop sharing", async () => {
		for (const fields of [{ clearRedditAuth: "1" }, { redditAuthCredential: "Bearer replacement", redditAuthType: "bearer" }]) {
			credential(1, { cookie: "reddit_session=shared-secret" }, 1);
			await request("/update-preferences", 1, { shareRedditCookie: "1", ...fields });
			expect(db.query("SELECT shareRedditCookie FROM users WHERE id = 1").get().shareRedditCookie).toBe(0);
			expect((await request("/r/test")).status).toBe(502);
		}
	});
});

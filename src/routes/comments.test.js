const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-comments-"));
const secret = "isolated-comments-test-secret";
const realFetch = globalThis.fetch;
let server;
let baseUrl;
let csrf;
let cookie;

beforeAll(async () => {
	fs.writeFileSync(path.join(dataDir, ".comments-test"), "Disposable test data");
	server = spawn(process.execPath, ["run", "--no-env-file", path.resolve("src/test-support/comments-server.cjs")], {
		env: {
			PATH: process.env.PATH, REDDONT_DATA_DIR: dataDir,
			REDDONT_PORT: "0", HTTP_BINDING: "127.0.0.1", JWT_SECRET_KEY: secret,
			REDDONT_DISABLE_SSL: "true", LOG_LEVEL: "info",
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
	const token = jwt.sign({ id: 1, username: "reader_res" }, secret, { expiresIn: "1h" });
	cookie = `auth_token=${token}`;
	const response = await realFetch(`${baseUrl}/comments/post1?sort=new`, { headers: { Cookie: cookie } });
	const html = await response.text();
	csrf = html.match(/name="csrf-token" content="([^"]+)"/)[1];
	cookie += `; csrf_token=${csrf}`;
}, 15000);

afterAll(async () => {
	if (server && server.exitCode === null) {
		const exited = new Promise((resolve) => server.once("exit", resolve));
		server.kill();
		await exited;
	}
	fs.rmSync(dataDir, { recursive: true, force: true });
});

function load(values = {}, accept = "application/json") {
	return realFetch(`${baseUrl}/comments/post1/more`, {
		method: "POST",
		headers: { Cookie: cookie, Accept: accept },
		body: new URLSearchParams({ _csrf: csrf, parent_id: "t3_post1", children: "c0,c1", count: "2", depth: "0", sort: "new", ...values }),
	});
}

describe("load more comment routes", () => {
	test("exposes the account's infinite-scroll preference on both comment views", async () => {
		for (const id of [1, 4]) {
			const token = jwt.sign({ id }, secret, { expiresIn: "1h" });
			for (const route of ["/comments/post1", "/comments/post1/comment/existing"]) {
				const response = await realFetch(baseUrl + route, { headers: { Cookie: `auth_token=${token}` } });
				const html = await response.text();
				expect(response.status).toBe(200);
				expect(html.includes('data-infinite-scroll="1"')).toBe(id === 4);
			}
		}
	});

	test("renders multiple siblings, nested replies, and a working continuation", async () => {
		const response = await load();
		expect(response.status).toBe(200);
		const { html } = await response.json();
		expect(html).toContain('id="c0"');
		expect(html).toContain('id="c1"');
		expect(html).toContain('id="child"');
		expect(html).toContain('id="grandchild"');
		expect(html).toContain('/comments/post1/comment/grandchild?sort=new');
		expect(html).toContain('&lt;script&gt; stays text.');
		expect(html).not.toContain('<script>');
		const requests = fs.readFileSync(path.join(dataDir, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
		expect(requests.at(-1)).toMatchObject({ path: "/api/morechildren.json", params: { children: "c0,c1", sort: "new", link_id: "t3_post1" }, authenticated: true });
	});

	test("keeps a large queue in the next form while limiting each upstream request", async () => {
		const children = Array.from({ length: 3548 }, (_, i) => `c${i}`).join(",");
		const response = await load({ children, count: "3550" });
		expect(response.status).toBe(200);
		const { html } = await response.json();
		expect(html).toContain('id="c99"');
		expect(html).not.toContain('id="c100"');
		expect(html).toContain('name="children" value="c100,c101,');
		expect(html).toContain('c3547"');
		expect(html).toContain('name="_csrf" value="' + csrf + '"');
	});

	test("preserves depth and parent for nested groups", async () => {
		const response = await load({ children: "reply1,reply2", parent_id: "t1_existing", depth: "1" });
		const { html } = await response.json();
		expect(html).toContain('class="comment    alt"');
		expect(html).toContain('id="reply1"');
		expect(html).toContain('id="reply2"');
		expect(html).toContain('href="#existing"');
	});

	test("supports ordinary form navigation without JavaScript", async () => {
		const response = await load({}, "text/html");
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('id="c0"');
		expect(html).toContain('id="c1"');
	});

	test("allows retrying upstream failures and handles deleted comments", async () => {
		expect((await load({ children: "failure" })).status).toBe(502);
		const retry = await load({ children: "failure" });
		expect((await retry.json()).html).toContain('id="failure"');
		const gone = await load({ children: "gone" });
		expect(await gone.json()).toEqual({ html: "" });
	});

	test("validates input and requires the normal session and CSRF protection", async () => {
		for (const values of [{ children: "" }, { children: "c1,../c2" }, { parent_id: "t3_other" }, { parent_id: "bad" }]) {
			expect((await load(values)).status).toBe(400);
		}
		expect((await load({ _csrf: "wrong" })).status).toBe(403);
		const response = await realFetch(`${baseUrl}/comments/post1/more`, {
			method: "POST", redirect: "manual",
			headers: { Cookie: `csrf_token=${csrf}` },
			body: new URLSearchParams({ _csrf: csrf }),
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toStartWith("/login?");
	});
});

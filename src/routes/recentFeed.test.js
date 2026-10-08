const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-recent-feed-"));
const secret = "isolated-recent-feed-test-secret";
const realFetch = globalThis.fetch;
let server;
let baseUrl;

beforeAll(async () => {
	fs.writeFileSync(path.join(dataDir, ".recent-feed-test"), "Disposable test data");
	server = spawn(process.execPath, ["run", "--no-env-file", path.resolve("src/test-support/recent-feed-server.cjs")], {
		env: {
			PATH: process.env.PATH, REDDONT_DATA_DIR: dataDir, REDDONT_PORT: "0",
			HTTP_BINDING: "127.0.0.1", JWT_SECRET_KEY: secret, REDDONT_DISABLE_SSL: "true",
			LOG_LEVEL: "info", RATE_LIMIT: "1000",
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
}, 15000);

afterAll(async () => {
	if (server && server.exitCode === null) {
		const exited = new Promise((resolve) => server.once("exit", resolve));
		server.kill();
		await exited;
	}
	fs.rmSync(dataDir, { recursive: true, force: true });
});

function request(route) {
	const token = jwt.sign({ id: 1 }, secret, { expiresIn: "1h" });
	return realFetch(baseUrl + route, { headers: { Cookie: `auth_token=${token}` }, redirect: "manual" });
}
function titles(html) {
	return [...html.matchAll(/>Feed post (recent\d+)<\/a>/g)].map((match) => match[1]);
}
const expected = Array.from({ length: 60 }, (_, i) => `recent${i}`);

describe("recent browser feeds", () => {
	test.each(["hot", "new", "rising", "controversial", "top"])("%s enforces a week on home, multi and community pages, retaining upstream order", async (sort) => {
		for (const route of ["/", "/r/test", "/r/test+other", "/r/all", "/r/popular"]) {
			const response = await request(`${route}?sort=${sort}&t=all`);
			const html = await response.text();
			expect(response.status).toBe(200);
			expect(titles(html)).toEqual(expected.slice(0, 25));
			expect(html).not.toContain("Feed post expired");
			expect(html).not.toContain("Feed post oldpin");
			expect(html).toContain("t=week");
		}
	});

	test.each(["hot", "new", "rising", "controversial", "top"])("%s paginates without losing or repeating eligible posts", async (sort) => {
		let route = `/api/r/home/posts?sort=${sort}&t=year`;
		const found = [];
		for (let page = 0; page < 10; page++) {
			const response = await request(route);
			expect(response.status).toBe(200);
			const body = await response.json();
			found.push(...titles(body.html));
			expect(body.html).not.toContain("Feed post expired");
			if (!body.after) break;
			route = `/api/r/home/posts?sort=${sort}&after=${body.after}&count=${found.length}`;
		}
		expect(found).toEqual(expected);
	});

	test("empty filtered pages preserve a manual next link for initial and infinite-scroll responses", async () => {
		const html = await (await request("/r/sparse")).text();
		expect(html).toContain("No posts from the past week on this page.");
		expect(html).toContain("after=t3_expired123");
		const body = await (await request("/api/r/sparse/posts?sort=hot")).json();
		expect(body.empty).toBe(true);
		expect(body.after).toBe("t3_expired123");
		expect(body.html).toContain("after=t3_expired123");
		const next = await (await request(`/api/r/sparse/posts?after=${body.after}`)).json();
		expect(titles(next.html)).toEqual(expected.slice(0, 25));
	});

	test("forwards normalized ranges and the reader's authentication on every scanned page", () => {
		const requests = fs.readFileSync(path.join(dataDir, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
		for (const request of requests.filter((r) => !r.path.endsWith("/about.json"))) {
			expect(request.params.t).toBe("week");
			expect(request.params.sr_detail).toBe("true");
			expect(request.params.view).toBeUndefined();
			expect(request.authorization).toBe("Bearer recent-feed-fixture");
		}
	});
});

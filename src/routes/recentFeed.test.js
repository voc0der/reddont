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

function request(route, id = 1) {
	const token = jwt.sign({ id }, secret, { expiresIn: "1h" });
	return realFetch(baseUrl + route, { headers: { Cookie: `auth_token=${token}` }, redirect: "manual" });
}
function titles(html) {
	return [...html.matchAll(/>Feed post ([a-z0-9]+)<\/a>/g)].map((match) => match[1]);
}
const expected = Array.from({ length: 60 }, (_, i) => `recent${i}`);

describe("recent browser feeds", () => {
	test.each(["hot", "new", "rising", "controversial", "top"])("%s enforces a week on home, all and popular, retaining upstream order", async (sort) => {
		for (const route of ["/", "/r/all", "/r/popular", "/r/Popular"]) {
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
		for (const feed of ["home", "all"]) {
			let route = `/api/r/${feed}/posts?sort=${sort}&t=year`;
			const found = [];
			for (let page = 0; page < 10; page++) {
				const response = await request(route);
				expect(response.status).toBe(200);
				const body = await response.json();
				found.push(...titles(body.html));
				expect(body.html).not.toContain("Feed post expired");
				if (!body.after) break;
				route = `/api/r/${feed}/posts?sort=${sort}&after=${body.after}&count=${found.length}`;
			}
			expect(found).toEqual(expected);
		}
	});

	test("empty filtered pages preserve a manual next link for initial and infinite-scroll responses", async () => {
		const html = await (await request("/r/all", 8)).text();
		expect(html).toContain("No posts from the past week on this page.");
		expect(html).toContain("after=t3_expired123");
		const body = await (await request("/api/r/all/posts?sort=hot", 8)).json();
		expect(body.empty).toBe(true);
		expect(body.after).toBe("t3_expired123");
		expect(body.html).toContain("after=t3_expired123");
		const next = await (await request(`/api/r/all/posts?after=${body.after}`, 8)).json();
		expect(titles(next.html)).toEqual(expected.slice(0, 25));
	});

	test.each(["hot", "new", "rising", "controversial", "top"])("%s keeps older community posts, with recent entries first", async (sort) => {
		for (const route of ["/r/test", "/r/test+other"]) {
			const response = await request(`${route}?sort=${sort}`);
			expect(response.status).toBe(200);
			const names = titles(await response.text());
			expect(names.length).toBe(25);
			expect(names).toContain("oldpin");
			expect(names[0]).toBe("recent0");
			const recent = names.filter((id) => id.startsWith("recent"));
			expect(names.slice(0, recent.length)).toEqual(recent);
		}
	});

	test.each(["hot", "new", "rising", "controversial", "top"])("%s shows quiet communities and pages through all their old posts", async (sort) => {
		const response = await request(`/r/quiet?sort=${sort}`);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(titles(html).length).toBe(25);
		expect(html).not.toContain("No posts");
		let after;
		const found = [];
		for (let page = 0; page < 3; page++) {
			const body = await (await request(`/api/r/quiet/posts?sort=${sort}${after ? `&after=${after}&count=${found.length}` : ""}`)).json();
			found.push(...titles(body.html));
			expect(body.expiresAt).toBeNull();
			if (!body.after) break;
			after = body.after;
		}
		expect(found).toEqual(["oldpin", ...Array.from({ length: 40 }, (_, i) => `expired${i}`)]);
	});

	test.each(["hot", "new", "rising", "controversial", "top"])("%s does not lose or repeat older posts when reordered pages continue", async (sort) => {
		let after;
		const found = [];
		for (let page = 0; page < 8; page++) {
			const body = await (await request(`/api/r/test+other/posts?sort=${sort}${after ? `&after=${after}&count=${found.length}` : ""}`)).json();
			const names = titles(body.html);
			const recent = names.filter((id) => id.startsWith("recent"));
			expect(names.slice(0, recent.length)).toEqual(recent);
			found.push(...names);
			if (!body.after) break;
			after = body.after;
		}
		const old = Array.from({ length: sort === "new" ? 1 : 60 }, (_, i) => `expired${i}`);
		expect(found.length).toBe(1 + old.length + expected.length);
		expect(new Set(found)).toEqual(new Set(["oldpin", ...old, ...expected]));
	});

	test("home without subscriptions uses the same strict all policy on both entry points", async () => {
		const response = await request("/?t=all", 7);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toContain("/r/all?sort=hot&t=week");
		const body = await (await request("/api/r/home/posts?t=all", 7)).json();
		expect(titles(body.html)).toEqual(expected.slice(0, 25));
		expect(body.expiresAt).toBeGreaterThan(Date.now());
	});

	test("subreddit historical ranges are preserved and forwarded", async () => {
		for (const t of ["month", "year", "all"]) {
			const body = await (await request(`/api/r/quiet/posts?sort=top&t=${t}`)).json();
			expect(titles(body.html)).toContain("expired0");
			expect(body.expiresAt).toBeNull();
			const last = JSON.parse(fs.readFileSync(path.join(dataDir, "requests.jsonl"), "utf8").trim().split("\n").at(-1));
			expect(last.params.t).toBe(t);
		}
	});

	test("forwards normalized ranges and the reader's authentication on every page", () => {
		const requests = fs.readFileSync(path.join(dataDir, "requests.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
		for (const request of requests.filter((r) => !r.path.endsWith("/about.json"))) {
			// Home lists its subscriptions alphabetically as other+test.
			if (/^\/r\/(all|popular|other\+test)\//i.test(request.path)) expect(request.params.t).toBe("week");
			else expect(["all", "month", "year"]).toContain(request.params.t);
			expect(request.params.sr_detail).toBe("true");
			expect(request.params.view).toBeUndefined();
			expect(["Bearer recent-feed-fixture", "Bearer sparse-feed-fixture"]).toContain(request.authorization);
		}
	});
});

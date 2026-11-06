const { afterAll, beforeAll, beforeEach, describe, expect, test } = require("bun:test");
const { Database } = require("bun:sqlite");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

// The Reddit authentication server, with teddit's instance-wide OAuth app on.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-instance-oauth-"));
const secret = "isolated-instance-oauth-test-secret";
const csrf = "isolated-csrf-token-for-instance-oauth-tests";
const INSTANCE_TOKEN = "Bearer token-for-instance-app-1";
const realFetch = globalThis.fetch;
let server;
let baseUrl;
let db;
let log = "";

beforeAll(async () => {
	fs.writeFileSync(path.join(dataDir, ".reddit-auth-test"), "Disposable test data");
	server = spawn(process.execPath, ["run", "--no-env-file", path.resolve("src/test-support/reddit-auth-server.cjs")], {
		env: {
			PATH: process.env.PATH, REDDONT_DATA_DIR: dataDir,
			REDDONT_PORT: "0", HTTP_BINDING: "127.0.0.1", JWT_SECRET_KEY: secret,
			REDDONT_DISABLE_SSL: "true", LOG_LEVEL: "info", RATE_LIMIT: "1000",
			USE_REDDIT_OAUTH: "true", REDDIT_APP_ID: "instance-app-1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	baseUrl = await new Promise((resolve, reject) => {
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
	db.query("UPDATE users SET redditAuthHeaders = NULL, shareRedditCookie = 0, redditOAuthAppId = NULL, shareRedditOAuth = 0, redditAuthPrimary = 'cookie'").run();
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

function request(route, id = 2) {
	const token = jwt.sign({ id }, secret, { expiresIn: "1h" });
	return realFetch(baseUrl + route, {
		headers: { Cookie: `auth_token=${token}; csrf_token=${csrf}` },
		redirect: "manual",
	});
}

function credential(id, headers, shared = 0) {
	db.query("UPDATE users SET redditAuthHeaders = ?, shareRedditCookie = ? WHERE id = ?")
		.run(headers === null ? null : JSON.stringify(headers), shared, id);
}

function oauthApp(id, appId, { primary = "cookie" } = {}) {
	db.query("UPDATE users SET redditOAuthAppId = ?, redditAuthPrimary = ? WHERE id = ?").run(appId, primary, id);
}

// Feed page requests to Reddit, as "host credential", in order.
function feedRequests() {
	return fs.readFileSync(path.join(dataDir, "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean)
		.map(JSON.parse)
		.filter(({ path }) => /^\/r\/\w+\/hot\/?$/.test(path))
		.map(({ host, headers }) => `${host} ${headers.Cookie || headers.Authorization}`);
}

async function dashboardPlan(id = 2) {
	return (await (await request("/dashboard", id)).text()).match(/Requests use [^.<]*\./)?.[0];
}

describe("instance-wide Reddit OAuth app", () => {
	test("asks Reddit for the app's token at startup", async () => {
		for (let i = 0; i < 100 && !log.includes("OAuth app a token"); i++) await Bun.sleep(50);
		expect(log).toContain("Reddit OAuth app from REDDIT_APP_ID is on for every user");
		expect(log).toContain("Reddit granted the instance's OAuth app a token");
	});

	test("serves users without their own authentication first, then what others share", async () => {
		expect((await request("/r/test")).status).toBe(200);
		expect(feedRequests()).toEqual(["oauth.reddit.com Bearer token-for-instance-app-1"]);
		expect(await dashboardPlan()).toBe("Requests use this instance's OAuth app.");

		credential(1, { cookie: "reddit_session=shared-secret" }, 1);
		fs.writeFileSync(path.join(dataDir, "requests.jsonl"), "");
		expect((await request("/r/oauthblocked")).status).toBe(200);
		expect(feedRequests()).toEqual([`oauth.reddit.com ${INSTANCE_TOKEN}`, "old.reddit.com reddit_session=shared-secret"]);
		expect(await dashboardPlan()).toBe("Requests use this instance's OAuth app, then a cookie another user shares.");
	});

	test("backs up users' own authentication, and tries an app with its ID once", async () => {
		credential(2, { cookie: "reddit_session=own" });
		expect((await request("/r/cookieblocked")).status).toBe(200);
		expect(feedRequests()).toEqual(["old.reddit.com reddit_session=own", `oauth.reddit.com ${INSTANCE_TOKEN}`]);
		expect(await dashboardPlan()).toBe("Requests use your saved credential, then this instance's OAuth app.");

		oauthApp(2, "instance-app-1", { primary: "oauth" });
		fs.writeFileSync(path.join(dataDir, "requests.jsonl"), "");
		expect((await request("/r/oauthblocked")).status).toBe(200);
		expect(feedRequests()).toEqual([`oauth.reddit.com ${INSTANCE_TOKEN}`, "old.reddit.com reddit_session=own"]);
		expect(await dashboardPlan()).toBe("Requests use your OAuth app, then your saved credential.");
	});

	test("doesn't send readers to the authentication settings, or serve signed-out visitors", async () => {
		const html = await (await request("/r/broken")).text();
		expect(html).toContain("Check Reddit authentication");
		expect(html).not.toContain("Add Reddit authentication");

		fs.writeFileSync(path.join(dataDir, "requests.jsonl"), "");
		const response = await realFetch(`${baseUrl}/r/test`, { redirect: "manual" });
		expect(response.headers.get("location")).toStartWith("/login?");
		expect(feedRequests()).toEqual([]);
	});
});

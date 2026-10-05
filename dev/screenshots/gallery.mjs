import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import fixtures from "./fixtures/content.cjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const require = createRequire(join(ROOT, "package.json"));
const jwt = require("jsonwebtoken");
const OUTPUT = join(ROOT, "docs/assets/screenshots");
const { NOW, MEDIA, posts } = fixtures;
const mediaNames = new Set(["lake.svg", "observatory.svg", "desk.svg", "sunrise.svg", "community.svg"]);
const errors = [];
const shots = [];
let browser;
let server;
let serverLog = "";
let runDir;
let cleanupPromise;

async function cleanup() {
	if (cleanupPromise) return cleanupPromise;
	cleanupPromise = (async () => {
		try {
			await browser?.close();
		} finally {
			if (server && server.exitCode === null && server.signalCode === null) {
				await new Promise((done) => {
					const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
					server.once("exit", () => { clearTimeout(timer); done(); });
					server.kill("SIGTERM");
				});
			}
			if (runDir) await rm(runDir, { recursive: true, force: true });
		}
	})();
	return cleanupPromise;
}

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
	process.once(signal, () => { cleanup().finally(() => process.exit(code)); });
}

async function startServer(secret) {
	// Deliberately do not inherit application settings or load the caller's .env.
	server = spawn("bun", ["run", "--no-env-file", join(HERE, "server.cjs")], {
		cwd: ROOT,
		env: {
			PATH: process.env.PATH,
			TZ: "UTC",
			REDDONT_DATA_DIR: runDir,
			REDDONT_PORT: "0",
			HTTP_BINDING: "127.0.0.1",
			JWT_SECRET_KEY: secret,
			REDDONT_DISABLE_SSL: "true",
			LOG_LEVEL: "info",
			RATE_LIMIT: "1000",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	return new Promise((done, fail) => {
		const timer = setTimeout(() => fail(new Error(`App startup timed out.\n${serverLog}`)), 20000);
		server.once("error", (error) => { clearTimeout(timer); fail(error); });
		server.once("exit", (code) => { clearTimeout(timer); fail(new Error(`App exited (${code}).\n${serverLog}`)); });
		const read = (chunk) => {
			serverLog += chunk.toString();
			const match = serverLog.match(/HTTP server started on port (\d+)/);
			if (match) {
				clearTimeout(timer);
				done(`http://127.0.0.1:${match[1]}`);
			}
		};
		server.stdout.on("data", read);
		server.stderr.on("data", read);
	});
}

async function newPage(base, secret, theme, phone = false) {
	const context = await browser.newContext({
		viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 },
		deviceScaleFactor: phone ? 2 : 1,
		isMobile: phone, hasTouch: phone,
		colorScheme: theme === "light" ? "light" : "dark",
		locale: "en-US", timezoneId: "UTC", reducedMotion: "reduce",
		serviceWorkers: "block",
	});
	const id = ["res", "light", "dark"].indexOf(theme) + 1;
	const token = jwt.sign({ id, username: `weekend_reader_${theme}`, iat: NOW / 1000 }, secret, { expiresIn: "1h" });
	await context.addCookies([{ name: "auth_token", value: token, url: base, httpOnly: true, sameSite: "Strict" }]);
	// Only this instance and checked-in illustrations may load. New external requests fail the run.
	await context.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin === base) return route.continue();
		let name;
		if (url.origin === MEDIA && mediaNames.has(basename(url.pathname))) name = basename(url.pathname);
		if (url.origin === "https://www.redditstatic.com" && url.pathname.startsWith("/avatars/defaults/v2/avatar_default_")) name = "community.svg";
		if (name) return route.fulfill({ contentType: "image/svg+xml", body: await readFile(join(HERE, "fixtures", name)) });
		errors.push(`Unexpected browser request: ${url.origin}${url.pathname}`);
		return route.abort();
	});
	const page = await context.newPage();
	await page.clock.setFixedTime(NOW);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("response", (response) => {
		if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
	});
	return page;
}

async function open(page, base, path, ready) {
	const response = await page.goto(base + path, { waitUntil: "networkidle" });
	assert(response.ok(), `${path}: HTTP ${response.status()}`);
	await page.locator(ready).first().waitFor();
}

async function shoot(page, name) {
	await page.evaluate(() => document.fonts.ready);
	await page.waitForFunction(() => [...document.images].every((image) => {
		const box = image.getBoundingClientRect();
		const visible = image.checkVisibility() && box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0;
		return !visible || (image.complete && image.naturalWidth > 0);
	}));
	await page.mouse.move(page.viewportSize().width - 1, 0);
	await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`);
	const path = join(runDir, "images", `${name}.png`);
	await page.screenshot({ path, animations: "disabled", caret: "hide" });
	shots.push(name);
	console.log(`Captured ${name}`);
}

async function main() {
	runDir = await mkdtemp(join(tmpdir(), "reddont-gallery-"));
	await writeFile(join(runDir, ".screenshot-run"), "Disposable gallery data\n");
	await mkdir(join(runDir, "images"));
	const secret = randomBytes(32).toString("hex");
	const base = await startServer(secret);
	console.log("Capturing the real app with fictional content...");
	browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

	const desktop = await newPage(base, secret, "res");
	await open(desktop, base, "/?view=compact", "article.post");
	assert.equal(await desktop.locator("article.post").count(), posts.length);
	await shoot(desktop, "desktop-home");
	await desktop.locator('.expando-button[aria-controls="lake"]').click();
	await desktop.locator("#lake[open]").waitFor();
	await shoot(desktop, "readme-home");
	await open(desktop, base, "/r/TrailNotes?view=compact", ".titlebox");
	await desktop.locator('.expando-button[aria-controls="lake"]').click();
	await shoot(desktop, "desktop-community");
	await open(desktop, base, "/comments/weekend?view=compact", ".comment-info-container");
	await shoot(desktop, "desktop-comments");
	await open(desktop, base, "/subs", "#subs-list .sub-title");
	await shoot(desktop, "desktop-subscriptions");
	await open(desktop, base, "/dashboard", "#pref-theme");
	await shoot(desktop, "desktop-preferences");
	await desktop.context().close();

	const light = await newPage(base, secret, "light");
	await open(light, base, "/?view=compact", "article.post");
	await light.locator('.expando-button[aria-controls="lake"]').click();
	await shoot(light, "desktop-light");
	await light.context().close();

	const phone = await newPage(base, secret, "dark", true);
	await open(phone, base, "/?view=card", "article.post");
	await shoot(phone, "phone-home");
	await open(phone, base, "/r/TrailNotes?view=card", ".m-community-name");
	await shoot(phone, "phone-community");
	await open(phone, base, "/comments/weekend?view=card", ".m-comment-head");
	await shoot(phone, "phone-comments");
	await open(phone, base, "/subs", "#subs-list .sub-title");
	await shoot(phone, "phone-subscriptions");
	await phone.context().close();

	assert(!serverLog.includes("UNMOCKED_UPSTREAM"), serverLog);
	assert.deepEqual(errors, [], "Browser errors or unexpected requests");
	// Publish only after every capture and assertion succeeds; failed runs leave old images intact.
	await mkdir(OUTPUT, { recursive: true });
	for (const name of shots) await cp(join(runDir, "images", `${name}.png`), join(OUTPUT, `${name}.png`));
	console.log(`Saved ${shots.length} screenshots to docs/assets/screenshots/`);
}

try {
	await main();
} catch (error) {
	console.error(error);
	if (serverLog.includes("UNMOCKED_UPSTREAM")) console.error(serverLog);
	process.exitCode = 1;
} finally {
	await cleanup();
}

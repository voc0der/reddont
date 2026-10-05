// Runs only as the capture harness's child process. The application itself has no demo mode.
const fs = require("node:fs");
const path = require("node:path");
const { NOW, subscriptions, responseFor } = require("./fixtures/content.cjs");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".screenshot-run"))) {
	throw new Error("Start this server through gallery.sh, which creates an isolated data directory.");
}
if (fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("Refusing to seed an existing database.");
}

const RealDate = Date;
globalThis.Date = class extends RealDate {
	constructor(...args) { super(...(args.length ? args : [NOW])); }
	static now() { return NOW; }
};

globalThis.fetch = async (input) => {
	try {
		const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
		return Response.json(responseFor(url));
	} catch (error) {
		console.error("UNMOCKED_UPSTREAM", error.message);
		throw error;
	}
};

const { db } = require("../../src/db");
const insertUser = db.query("INSERT INTO users (username, isAdmin, themePreference, infiniteScroll, highResThumbnails, redditAuthHeaders) VALUES (?, 1, ?, 0, 1, ?)");
for (const [index, theme] of ["res", "light", "dark"].entries()) {
	insertUser.run(`weekend_reader_${theme}`, theme, JSON.stringify({ authorization: "Bearer fictional-gallery-token" }));
	for (const sub of subscriptions) {
		db.query("INSERT INTO subscriptions (user_id, subreddit) VALUES (?, ?)").run(index + 1, sub);
	}
}
require("../../src/index");

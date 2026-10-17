const { describe, expect, test } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Opens the database in a separate process with only the given environment.
function openDatabase(env) {
	const result = spawnSync(process.execPath, [
		"run",
		"--no-env-file",
		"--preload",
		path.join(__dirname, "test-support", "no-data-volume.cjs"),
		path.join(__dirname, "db.js"),
	], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
}

describe("data directory", () => {
	test("uses REDDONT_DATA_DIR, then XDG_DATA_HOME, then ~/.local/share outside a container", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-data-dir-"));
		const database = (...parts) => fs.existsSync(path.join(root, ...parts, "reddont.db"));
		try {
			openDatabase({ HOME: path.join(root, "home"), XDG_DATA_HOME: path.join(root, "xdg"), REDDONT_DATA_DIR: path.join(root, "explicit") });
			expect(database("explicit")).toBe(true);
			expect(database("xdg", "reddont")).toBe(false);

			openDatabase({ HOME: path.join(root, "home"), XDG_DATA_HOME: path.join(root, "xdg") });
			expect(database("xdg", "reddont")).toBe(true);
			expect(database("home", ".local", "share", "reddont")).toBe(false);

			openDatabase({ HOME: path.join(root, "home") });
			expect(database("home", ".local", "share", "reddont")).toBe(true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	}, 15000);
});

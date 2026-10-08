const { describe, expect, test } = require("bun:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("server startup", () => {
	test("stops instead of serving plain HTTP when the TLS files cannot be read", async () => {
		const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-startup-"));
		try {
			const server = spawn(process.execPath, ["run", "--no-env-file", path.join(__dirname, "index.js")], {
				env: {
					PATH: process.env.PATH,
					REDDONT_DATA_DIR: dataDir,
					REDDONT_PORT: "0",
					HTTP_BINDING: "127.0.0.1",
					REDDONT_SSL_CERT_PATH: path.join(dataDir, "missing-cert.pem"),
					REDDONT_SSL_KEY_PATH: path.join(dataDir, "missing-key.pem"),
				},
				stdio: ["ignore", "pipe", "pipe"],
			});
			let log = "";
			server.stdout.on("data", (chunk) => { log += chunk; });
			server.stderr.on("data", (chunk) => { log += chunk; });
			const code = await new Promise((resolve) => server.once("exit", resolve));

			expect(code).toBe(1);
			expect(log).toContain("Failed to load SSL certificate or key");
			expect(log).not.toContain("server started");
		} finally {
			fs.rmSync(dataDir, { recursive: true, force: true });
		}
	}, 15000);
});

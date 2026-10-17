const { describe, expect, test } = require("bun:test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { selfSignedCertificate } = require("./test-support/certificate.cjs");
const { responseCookies } = require("./test-support/server.cjs");

// Starts the app directly with a temporary data directory and only the given
// settings, collecting its log output.
function startApp(dataDir, env) {
	const app = spawn(process.execPath, ["run", "--no-env-file", path.join(__dirname, "index.js")], {
		env: {
			PATH: process.env.PATH,
			REDDONT_DATA_DIR: dataDir,
			REDDONT_PORT: "0",
			HTTP_BINDING: "127.0.0.1",
			...env,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	app.log = "";
	app.stdout.on("data", (chunk) => { app.log += chunk; });
	app.stderr.on("data", (chunk) => { app.log += chunk; });
	app.exited = new Promise((resolve) => app.once("exit", resolve));
	return app;
}

// The HTTPS startup message names the configured port, so the test picks one.
async function freePort() {
	const probe = net.createServer();
	await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const { port } = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

async function waitForLog(app, text) {
	for (let i = 0; i < 200 && !app.log.includes(text); i++) {
		if (app.exitCode !== null) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	expect(app.log).toContain(text);
}

describe("server startup", () => {
	test("stops instead of serving plain HTTP when the TLS files cannot be read", async () => {
		const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-startup-"));
		try {
			const app = startApp(dataDir, {
				REDDONT_SSL_CERT_PATH: path.join(dataDir, "missing-cert.pem"),
				REDDONT_SSL_KEY_PATH: path.join(dataDir, "missing-key.pem"),
			});
			expect(await app.exited).toBe(1);
			expect(app.log).toContain("Failed to load SSL certificate or key");
			expect(app.log).not.toContain("server started");
		} finally {
			fs.rmSync(dataDir, { recursive: true, force: true });
		}
	}, 15000);

	test("serves HTTPS with the configured certificate and secure cookies", async () => {
		const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-startup-"));
		const { cert, key } = selfSignedCertificate();
		fs.writeFileSync(path.join(dataDir, "cert.pem"), cert);
		fs.writeFileSync(path.join(dataDir, "key.pem"), key);
		const port = await freePort();
		const app = startApp(dataDir, {
			REDDONT_PORT: String(port),
			REDDONT_SSL_CERT_PATH: path.join(dataDir, "cert.pem"),
			REDDONT_SSL_KEY_PATH: path.join(dataDir, "key.pem"),
		});
		try {
			await waitForLog(app, `HTTPS server started on port ${port}`);
			const response = await fetch(`https://127.0.0.1:${port}/login`, { tls: { ca: cert } });

			expect(response.status).toBe(200);
			expect(await response.text()).toContain('name="password"');
			expect(responseCookies(response).csrf_token.attributes).toContain("secure");
		} finally {
			app.kill();
			await app.exited;
			fs.rmSync(dataDir, { recursive: true, force: true });
		}
	}, 15000);
});

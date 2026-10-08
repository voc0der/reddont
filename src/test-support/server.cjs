// Starts a fixture script as an isolated reddont process for route tests. Each
// server gets a marked, empty temporary data directory and no environment
// beyond PATH and the settings a test passes.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function startServer(script, marker, env = {}) {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `reddont-${marker}-`));
	fs.writeFileSync(path.join(dataDir, `.${marker}`), "Disposable test data");
	const child = spawn(process.execPath, ["run", "--no-env-file", path.join(__dirname, script)], {
		env: {
			PATH: process.env.PATH,
			REDDONT_DATA_DIR: dataDir,
			REDDONT_PORT: "0",
			HTTP_BINDING: "127.0.0.1",
			REDDONT_DISABLE_SSL: "true",
			LOG_LEVEL: "info",
			RATE_LIMIT: "1000",
			...env,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	const baseUrl = await new Promise((resolve, reject) => {
		let log = "";
		const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${log}`)), 10000);
		const read = (chunk) => {
			log += chunk;
			const match = log.match(/HTTP server started on port (\d+)/);
			if (match) {
				clearTimeout(timeout);
				resolve(`http://127.0.0.1:${match[1]}`);
			}
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(new Error(`Server exited ${code}: ${log}`));
		});
	});

	return {
		baseUrl,
		dataDir,
		requests() {
			const file = path.join(dataDir, "requests.jsonl");
			if (!fs.existsSync(file)) return [];
			return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
		},
		async stop() {
			if (child.exitCode === null) {
				const exited = new Promise((resolve) => child.once("exit", resolve));
				child.kill();
				await exited;
			}
			fs.rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

// Reads Set-Cookie headers into { name: { value, attributes } }.
function responseCookies(response) {
	const cookies = {};
	for (const header of response.headers.getSetCookie()) {
		const [pair, ...attributes] = header.split(";").map((part) => part.trim());
		const separator = pair.indexOf("=");
		cookies[pair.slice(0, separator)] = {
			value: pair.slice(separator + 1),
			attributes: attributes.map((attribute) => attribute.toLowerCase()),
		};
	}
	return cookies;
}

module.exports = { responseCookies, startServer };

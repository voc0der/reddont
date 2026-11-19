// Hold asynchronous work at a known point so user-management tests can send
// a second request before the first one resumes. No timing assumptions about
// password hashing or identity-provider responses are needed.
const fs = require("node:fs");
const path = require("node:path");
const oidc = require("../oidc");
const dataDir = process.env.REDDONT_DATA_DIR;

function paused(operation) {
	return fs.existsSync(path.join(dataDir, `${operation}.pause`));
}

async function waitAtGate(operation) {
	if (!paused(operation)) return;
	fs.writeFileSync(path.join(dataDir, `${operation}.waiting`), "Paused");
	while (paused(operation)) await Bun.sleep(10);
}

const hash = Bun.password.hash;
Bun.password.hash = async (...args) => {
	await waitAtGate("password");
	return hash(...args);
};

const refresh = oidc.refreshAccessToken;
oidc.refreshAccessToken = async (...args) => {
	if (!paused("refresh")) return refresh(...args);
	await waitAtGate("refresh");
	return false;
};

require("./accounts-server.cjs");

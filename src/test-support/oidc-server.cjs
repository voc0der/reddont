// Isolated OpenID provider fixture for single sign-on route checks.
const fs = require("node:fs");
const path = require("node:path");
const { ISSUER, createFakeIdp } = require("./fake-idp.cjs");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".oidc-test")) || fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("OIDC tests require a marked, empty temporary data directory");
}

const idp = createFakeIdp({
	clientId: process.env.OIDC_CLIENT_ID,
	clientSecret: process.env.OIDC_CLIENT_SECRET,
	onRequest: (request) => fs.appendFileSync(path.join(dataDir, "requests.jsonl"), `${JSON.stringify(request)}\n`),
});
globalThis.fetch = async (input, init) => {
	if (new URL(input).origin === ISSUER) return idp.fetch(input, init);
	throw new Error(`Unexpected upstream request: ${input}`);
};
require("../index");

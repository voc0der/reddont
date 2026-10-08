// Isolated fixture for account, session, and settings route checks. None of
// these pages should contact Reddit.
const fs = require("node:fs");
const path = require("node:path");
const dataDir = process.env.REDDONT_DATA_DIR;
if (!dataDir || !fs.existsSync(path.join(dataDir, ".accounts-test")) || fs.existsSync(path.join(dataDir, "reddont.db"))) {
	throw new Error("Account tests require a marked, empty temporary data directory");
}

globalThis.fetch = async (input) => {
	throw new Error(`Unexpected upstream request: ${input}`);
};
require("../index");

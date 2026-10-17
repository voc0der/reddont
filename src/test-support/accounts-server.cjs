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
// Tests connect over localhost, which header sign-in always trusts. An
// X-Test-Peer header stands in for a request from another address.
const http = require("node:http");
const createServer = http.createServer;
const simulatedPeers = new WeakSet();
http.createServer = (...args) => {
	const server = createServer(...args);
	server.prependListener("request", (req) => {
		const peer = req.headers["x-test-peer"];
		if (peer) {
			Object.defineProperty(req.socket, "remoteAddress", { value: peer, configurable: true });
			simulatedPeers.add(req.socket);
		} else if (simulatedPeers.delete(req.socket)) {
			// A kept-alive connection reuses the socket for later requests.
			delete req.socket.remoteAddress;
		}
	});
	return server;
};
require("../index");

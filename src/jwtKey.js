const crypto = require("node:crypto");

// The key that signs sessions; hashed, it also encrypts stored OIDC refresh
// tokens. JWT_SECRET_KEY keeps it across restarts. When that's unset or
// blank, each start makes a random 256-bit key, so sessions and refresh
// tokens last only until the next restart, and no one can work the key out.
function resolveJwtKey(env = process.env) {
	const configured = env.JWT_SECRET_KEY;
	if (typeof configured === "string" && configured.trim()) {
		return { key: configured, generated: false };
	}
	return { key: crypto.randomBytes(32).toString("hex"), generated: true };
}

module.exports = { resolveJwtKey };

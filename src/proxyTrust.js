// Which peers' forwarded headers (X-Forwarded-For, X-Forwarded-Proto) count,
// as Express's "trust proxy" setting; null leaves them all ignored.
//
// They count only from a trusted proxy: one in REVERSE_PROXY_WHITELIST.
// Without the list, OIDC and header login still trust a proxy on loopback or a
// private network, where a Docker or LAN proxy sits, but never whoever
// connects: a client could then name its own address, and with it its own
// rate-limit and sign-in budgets.
const PRIVATE_NETWORKS = ["loopback", "linklocal", "uniquelocal"];

function trustProxySetting(env, { oidcEnabled = false } = {}) {
	const listed = String(env.REVERSE_PROXY_WHITELIST || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (listed.length > 0) return listed;
	if (env.REMOTE_HEADER_LOGIN || oidcEnabled) return PRIVATE_NETWORKS;
	return null;
}

module.exports = { PRIVATE_NETWORKS, trustProxySetting };

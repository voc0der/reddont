const SAFE_REDIRECT_FALLBACK = "/";
const BASE = "http://localhost";

// A path on this site to send a browser to, from a value such as ?redirect=,
// or the fallback. The result is checked as a browser reads it in a Location
// header, after the URL parser has resolved it: dot segments can turn an
// accepted path into one that names another host ("/a/..//evil.com" resolves
// to "//evil.com").
function getSafeRedirectTarget(value, fallback = SAFE_REDIRECT_FALLBACK) {
	const raw = Array.isArray(value) ? value[0] : value;
	if (typeof raw !== "string") return fallback;
	const trimmed = raw.trim();
	if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//"))
		return fallback;
	if (trimmed.includes("\\") || trimmed.includes("\0")) return fallback;

	try {
		const parsed = new URL(trimmed, BASE);
		if (parsed.origin !== BASE) return fallback;
		const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
		if (target.startsWith("//") || new URL(target, BASE).origin !== BASE) return fallback;
		return target;
	} catch {
		return fallback;
	}
}

module.exports = { SAFE_REDIRECT_FALLBACK, getSafeRedirectTarget };

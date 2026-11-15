const { describe, expect, test } = require("bun:test");
const proxyaddr = require("proxy-addr");
const { trustProxySetting } = require("./proxyTrust");

// The address Express gives a request (req.ip) from `peer`, which says the
// client is at 198.51.100.7.
function clientAddress(setting, peer) {
	const req = { socket: { remoteAddress: peer }, headers: { "x-forwarded-for": "198.51.100.7" } };
	return proxyaddr(req, setting ? proxyaddr.compile(setting) : () => false);
}

describe("forwarded headers", () => {
	test("count only from the listed proxies when REVERSE_PROXY_WHITELIST is set", () => {
		const setting = trustProxySetting({ REVERSE_PROXY_WHITELIST: " 172.30.0.2, ,10.1.0.0/16 " });
		expect(setting).toEqual(["172.30.0.2", "10.1.0.0/16"]);
		expect(clientAddress(setting, "172.30.0.2")).toBe("198.51.100.7");
		expect(clientAddress(setting, "10.1.2.3")).toBe("198.51.100.7");
		for (const peer of ["172.30.0.3", "127.0.0.1", "203.0.113.10"]) {
			expect(clientAddress(setting, peer)).toBe(peer);
		}
	});

	test("count from loopback and private networks for OIDC and header login without a list", () => {
		for (const setting of [
			trustProxySetting({ REMOTE_HEADER_LOGIN: "true" }),
			trustProxySetting({}, { oidcEnabled: true }),
		]) {
			for (const peer of ["127.0.0.1", "::1", "172.18.0.2", "10.0.0.5", "192.168.1.20", "fd00::2", "169.254.1.1"]) {
				expect(clientAddress(setting, peer)).toBe("198.51.100.7");
			}
			// Anyone else who connects names only themselves.
			for (const peer of ["203.0.113.10", "8.8.8.8", "2001:db8::1"]) {
				expect(clientAddress(setting, peer)).toBe(peer);
			}
		}
	});

	test("count from no one otherwise", () => {
		expect(trustProxySetting({})).toBeNull();
		expect(trustProxySetting({ REVERSE_PROXY_WHITELIST: " , " })).toBeNull();
		expect(clientAddress(null, "127.0.0.1")).toBe("127.0.0.1");
	});
});

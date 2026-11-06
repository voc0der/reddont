// Fuzz tests: which source addresses reach the API. API_WHITELIST is the only thing
// between a network and the API key check, so an address it doesn't list must never
// pass, whatever else the list holds and however the socket writes the address.
const { afterAll, describe, expect, test } = require("bun:test");
const fc = require("fast-check");
const net = require("node:net");
const { isApiWhitelisted } = require("../apiAuth");
const { check, timeout } = require("../test-support/fuzz.cjs");

const saved = process.env.API_WHITELIST;
afterAll(() => {
	if (saved === undefined) Reflect.deleteProperty(process.env, "API_WHITELIST");
	else process.env.API_WHITELIST = saved;
});

const ipv4 = fc.ipV4();
// IPv6 outside the IPv4-mapped range, which the whitelist reads as IPv4.
const hextet = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 0xffff }));
const ipv6 = fc.tuple(fc.constantFrom(0x2001, 0x2a00, 0xfc00, 0xfd12, 0xfe80), fc.array(hextet, { minLength: 7, maxLength: 7 }), fc.boolean(), fc.boolean())
	.map(([first, rest, compress, upper]) => {
		let text = [first, ...rest].map((group) => group.toString(16)).join(":");
		if (compress) text = text.replace(/(^|:)0(:0)+(:|$)/, "::");
		return upper ? text.toUpperCase() : text;
	});
// How a dual-stack socket reports an IPv4 peer.
const address = fc.oneof(ipv4, ipv6, ipv4.map((plain) => `::ffff:${plain}`), ipv4.map((plain) => `::FFFF:${plain}`));

// Prefix lengths, well-formed and not: an empty one, signs, leading zeros, spaces,
// hex and exponents, and lengths past the family's.
const prefix = fc.oneof(
	fc.integer({ min: 0, max: 128 }).map(String),
	fc.constantFrom("", "-1", "08", "024", " 8", "8 ", "0x8", "1e1", "33", "129", "8/9", "+8", "8.0"),
);
const entry = fc.oneof(
	address,
	fc.tuple(fc.oneof(ipv4, ipv6), prefix).map(([network, length]) => `${network}/${length}`),
);
const list = fc.array(entry, { minLength: 1, maxLength: 5 }).map((entries) => entries.join(", "));

function toBigInt(text) {
	if (net.isIPv4(text)) return text.split(".").reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n);
	const [head, tail] = text.includes("::") ? text.split("::") : [text, null];
	const headGroups = head ? head.split(":") : [];
	const tailGroups = tail ? tail.split(":") : [];
	const groups = tail === null ? headGroups : [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups];
	return groups.reduce((value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

// The address as compared: a dual-stack socket's IPv4-mapped form is IPv4.
function plain(text) {
	return /^::ffff:/i.test(text) ? text.slice(7) : text;
}

// Whether a well-formed entry lists the address, worked out bit by bit. A
// malformed entry lists nothing.
function lists(entryText, addressText) {
	const target = plain(addressText);
	// The values that mean any address, 0.0.0.0/0 and ::/0 for both families.
	if (["*", "all", "any", "0.0.0.0/0", "::/0"].includes(entryText.trim().toLowerCase())) return true;
	const [network, length, extra] = entryText.trim().split("/");
	if (length === undefined) return plain(network).toLowerCase() === target.toLowerCase();
	if (extra !== undefined || !/^(0|[1-9][0-9]{0,2})$/.test(length)) return false;
	const family = net.isIPv4(network) ? 4 : net.isIPv6(network) ? 6 : 0;
	const bits = family === 4 ? 32 : 128;
	if (!family || Number(length) > bits) return false;
	if ((family === 4) !== net.isIPv4(target) || (!net.isIPv4(target) && !net.isIPv6(target))) return false;
	const shift = BigInt(bits - Number(length));
	return toBigInt(target) >> shift === toBigInt(network) >> shift;
}

describe("Fuzz: API source whitelist", () => {
	test("let an address through only when a well-formed entry lists it", () =>
		check("whitelisted addresses are listed", fc.property(list, address, (whitelist, peer) => {
			process.env.API_WHITELIST = whitelist;
			if (isApiWhitelisted(peer)) {
				expect(whitelist.split(",").some((part) => lists(part, peer))).toBe(true);
			}
		}), [
			// An empty prefix length was read as /0 and let every address through.
			["10.0.0.0/", "8.8.8.8"],
			["2001:db8::/", "2a00::1"],
		]), timeout);

	test("let through every address a well-formed range lists", () =>
		check("listed addresses are whitelisted", fc.property(fc.oneof(ipv4, ipv6), fc.integer({ min: 0, max: 128 }), address, (network, length, peer) => {
			const bits = net.isIPv4(network) ? 32 : 128;
			const entry = `${network}/${Math.min(length, bits)}`;
			process.env.API_WHITELIST = entry;
			if (lists(entry, peer)) expect(isApiWhitelisted(peer)).toBe(true);
		})), timeout);
});

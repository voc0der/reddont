const { beforeEach, describe, expect, test } = require("bun:test");
const limits = require("./loginLimits");

const {
	MAX_ENTRIES,
	MAX_FAILURES_PER_ADDRESS,
	MAX_FAILURES_PER_USERNAME,
	WINDOW_MS,
	clearLoginFailures,
	isLoginBlocked,
	recordLoginFailure,
} = limits;
const start = 1_000_000;

function fail(times, address, username, now = start) {
	for (let i = 0; i < times; i += 1) recordLoginFailure(address, username, now);
}

beforeEach(() => limits.resetLoginLimits());

describe("failed sign-ins", () => {
	test("block a username at an address after ten", () => {
		fail(MAX_FAILURES_PER_USERNAME - 1, "198.51.100.7", "owner");
		expect(isLoginBlocked("198.51.100.7", "owner", start)).toBe(false);
		fail(1, "198.51.100.7", "owner");
		expect(isLoginBlocked("198.51.100.7", "owner", start)).toBe(true);

		// Only that username, and only from that address.
		expect(isLoginBlocked("198.51.100.7", "reader", start)).toBe(false);
		expect(isLoginBlocked("198.51.100.7", "Owner", start)).toBe(false);
		expect(isLoginBlocked("203.0.113.10", "owner", start)).toBe(false);
	});

	test("block an address after thirty, whatever the usernames", () => {
		for (let i = 0; i < MAX_FAILURES_PER_ADDRESS - 1; i += 1) fail(1, "198.51.100.7", `user-${i}`);
		expect(isLoginBlocked("198.51.100.7", "owner", start)).toBe(false);
		fail(1, "198.51.100.7", "another");
		expect(isLoginBlocked("198.51.100.7", "owner", start)).toBe(true);
		expect(isLoginBlocked("203.0.113.10", "owner", start)).toBe(false);
	});

	test("count for fifteen minutes from the first", () => {
		fail(MAX_FAILURES_PER_USERNAME, "198.51.100.7", "owner");
		expect(isLoginBlocked("198.51.100.7", "owner", start + WINDOW_MS - 1)).toBe(true);
		expect(isLoginBlocked("198.51.100.7", "owner", start + WINDOW_MS)).toBe(false);

		// A new window starts with the next failure.
		fail(MAX_FAILURES_PER_USERNAME - 1, "198.51.100.7", "owner", start + WINDOW_MS);
		expect(isLoginBlocked("198.51.100.7", "owner", start + WINDOW_MS)).toBe(false);
	});

	test("a success clears its username's count but not the address's", () => {
		const nearLimit = MAX_FAILURES_PER_USERNAME - 1;
		fail(nearLimit, "198.51.100.7", "owner");
		clearLoginFailures("198.51.100.7", "owner");
		fail(nearLimit, "198.51.100.7", "owner");
		expect(isLoginBlocked("198.51.100.7", "owner", start)).toBe(false);

		// The address has all of them.
		fail(MAX_FAILURES_PER_ADDRESS - 2 * nearLimit - 1, "198.51.100.7", "reader-1");
		expect(isLoginBlocked("198.51.100.7", "reader-2", start)).toBe(false);
		fail(1, "198.51.100.7", "reader-3");
		expect(isLoginBlocked("198.51.100.7", "reader-2", start)).toBe(true);
	});

	test("count an IPv6 client by its /56", () => {
		fail(MAX_FAILURES_PER_USERNAME, "2001:db8:abcd:1201::1", "owner");
		expect(isLoginBlocked("2001:db8:abcd:12ff::99", "owner", start)).toBe(true);
		expect(isLoginBlocked("2001:db8:abcd:1300::1", "owner", start)).toBe(false);

		fail(MAX_FAILURES_PER_USERNAME, "::ffff:198.51.100.7", "reader");
		expect(isLoginBlocked("198.51.100.7", "reader", start)).toBe(true);
	});

	test("tell long usernames apart by their first 256 characters", () => {
		const long = "a".repeat(10000);
		fail(MAX_FAILURES_PER_USERNAME, "198.51.100.7", `${long}x`);
		expect(isLoginBlocked("198.51.100.7", `${long}y`, start)).toBe(true);
		expect(isLoginBlocked("198.51.100.7", "a".repeat(255), start)).toBe(false);
	});

	test("keep a bounded number of counts, dropping the oldest first", () => {
		fail(MAX_FAILURES_PER_USERNAME, "198.51.100.7", "owner", start);
		for (let i = 0; i < MAX_ENTRIES; i += 1) {
			recordLoginFailure(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, "guess", start + 1);
		}
		expect(limits.trackedEntries()).toBeLessThanOrEqual(MAX_ENTRIES);
		expect(isLoginBlocked("198.51.100.7", "owner", start + 1)).toBe(false);

		// Once full, every expired window goes at once.
		limits.resetLoginLimits();
		for (let i = 0; i < MAX_ENTRIES / 2; i += 1) recordLoginFailure(`10.0.${i >> 8}.${i & 255}`, "guess", start);
		expect(limits.trackedEntries()).toBe(MAX_ENTRIES);
		fail(MAX_FAILURES_PER_USERNAME, "198.51.100.7", "owner", start + WINDOW_MS);
		expect(limits.trackedEntries()).toBe(2);
		expect(isLoginBlocked("198.51.100.7", "owner", start + WINDOW_MS)).toBe(true);
	});
});

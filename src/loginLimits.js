// Failed password sign-ins, counted per client address and per address and
// username over a 15-minute window. Past either limit, sign-ins from that
// address (for that username) aren't checked until the window ends, so the
// form can't be used to guess passwords. The browser-wide RATE_LIMIT still
// applies on top of this.
const { ipKeyGenerator } = require("express-rate-limit");

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ADDRESS = 30;
const MAX_FAILURES_PER_USERNAME = 10;
// The counts live in memory. The cap keeps a flood of made-up usernames from
// growing it without bound; the oldest windows go first.
const MAX_ENTRIES = 10000;
// Enough to tell usernames apart without keeping a huge one per entry.
const USERNAME_KEY_LENGTH = 256;

const failures = new Map();

// An IPv6 client has a whole subnet to send from, so it counts by its /56,
// as the browser rate limit does.
function keysFor(address, username) {
	const source = ipKeyGenerator(String(address));
	const name = String(username).slice(0, USERNAME_KEY_LENGTH);
	return { addressKey: `address ${source}`, usernameKey: `username ${source} ${name}` };
}

function failuresFor(key, now) {
	const entry = failures.get(key);
	if (!entry) return 0;
	if (entry.resetAt <= now) {
		failures.delete(key);
		return 0;
	}
	return entry.count;
}

function isLoginBlocked(address, username, now = Date.now()) {
	const { addressKey, usernameKey } = keysFor(address, username);
	return (
		failuresFor(addressKey, now) >= MAX_FAILURES_PER_ADDRESS ||
		failuresFor(usernameKey, now) >= MAX_FAILURES_PER_USERNAME
	);
}

function countFailure(key, now) {
	const entry = failures.get(key);
	if (entry && entry.resetAt > now) {
		entry.count += 1;
		return;
	}
	failures.delete(key);
	failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
}

function prune(now) {
	if (failures.size <= MAX_ENTRIES) return;
	for (const [key, entry] of failures) {
		if (entry.resetAt <= now) failures.delete(key);
	}
	for (const key of failures.keys()) {
		if (failures.size <= MAX_ENTRIES) break;
		failures.delete(key);
	}
}

function recordLoginFailure(address, username, now = Date.now()) {
	const { addressKey, usernameKey } = keysFor(address, username);
	countFailure(addressKey, now);
	countFailure(usernameKey, now);
	prune(now);
}

// A successful sign-in clears its username's count at that address. The
// address's own count stays, so cycling through usernames still runs out.
function clearLoginFailures(address, username) {
	failures.delete(keysFor(address, username).usernameKey);
}

function resetLoginLimits() {
	failures.clear();
}

module.exports = {
	MAX_ENTRIES,
	MAX_FAILURES_PER_ADDRESS,
	MAX_FAILURES_PER_USERNAME,
	WINDOW_MS,
	clearLoginFailures,
	isLoginBlocked,
	recordLoginFailure,
	resetLoginLimits,
	trackedEntries: () => failures.size,
};

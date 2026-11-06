const logger = require("./logger");

// Reddit's application-only OAuth for an "installed app", as teddit's
// use_reddit_oauth does it: the app's ID alone, with no secret and no Reddit
// account, gets a bearer token for oauth.reddit.com. Apps are created at
// https://old.reddit.com/prefs/apps/ ("installed app" type).
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const INSTALLED_CLIENT_GRANT = "https://oauth.reddit.com/grants/installed_client";
// Reddit's device ID for clients that ask not to be tracked.
const DEVICE_ID = "DO_NOT_TRACK_THIS_DEVICE";
// Reddit granted 24-hour tokens on 2026-11-05; renew a little before expiry.
const RENEW_EARLY_MS = 5 * 60 * 1000;
const DEFAULT_LIFETIME_MS = 60 * 60 * 1000;
// After Reddit refuses an app, wait before asking again, so a revoked app
// doesn't cost a token request on every page.
const RETRY_AFTER_MS = 60 * 1000;
const APP_ID_PATTERN = /^[A-Za-z0-9_-]{10,40}$/;

// App ID -> { token, expiresAt } once Reddit grants one, { retryAt } after it
// refuses, or { pending } while asking.
const tokens = new Map();

function normalizeRedditAppId(input) {
	const value = String(input ?? "")
		.trim()
		.replace(/^(["'])(.*)\1$/, "$2")
		.trim();
	if (!value) return null;
	if (!APP_ID_PATTERN.test(value)) {
		throw new Error("Reddit app ID is invalid");
	}
	return value;
}

async function requestToken(appId, userAgent) {
	try {
		const response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: {
				Authorization: `Basic ${Buffer.from(`${appId}:`).toString("base64")}`,
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": userAgent,
			},
			body: new URLSearchParams({
				grant_type: INSTALLED_CLIENT_GRANT,
				device_id: DEVICE_ID,
			}).toString(),
		});
		const body = await response.json().catch(() => null);
		const token = body?.access_token;
		if (!response.ok || typeof token !== "string" || !token || /[\s\0-\x1F\x7F]/.test(token)) {
			logger.warn("Reddit refused an OAuth token request", {
				status: response.status,
				...(typeof body?.error === "string" ? { error: body.error } : {}),
			});
			return null;
		}
		const seconds = Number(body.expires_in);
		const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_LIFETIME_MS;
		return { token, expiresAt: Date.now() + Math.max(lifetime - RENEW_EARLY_MS, lifetime / 2) };
	} catch (error) {
		logger.warn("Reddit OAuth token request failed", { error: error?.message || String(error) });
		return null;
	}
}

// A bearer token for the app, or null when Reddit won't grant one. Callers
// asking at the same time share one token request.
async function getRedditOAuthToken(appId, userAgent) {
	const entry = tokens.get(appId);
	const now = Date.now();
	if (entry?.pending) return entry.pending;
	if (entry?.token && now < entry.expiresAt) return entry.token;
	if (entry?.retryAt && now < entry.retryAt) return null;

	const pending = requestToken(appId, userAgent).then((granted) => {
		tokens.set(appId, granted || { retryAt: Date.now() + RETRY_AFTER_MS });
		return granted?.token || null;
	});
	tokens.set(appId, { pending });
	return pending;
}

// Drops a token Reddit stopped accepting, so the next request asks for a new
// one. Tokens this module didn't grant are ignored.
function forgetRedditOAuthToken(token) {
	for (const [appId, entry] of tokens) {
		if (token && entry.token === token) tokens.delete(appId);
	}
}

// teddit's instance-wide settings, with its names: USE_REDDIT_OAUTH=true
// turns on the app REDDIT_APP_ID names, for every signed-in user.
function isInstanceRedditOAuthOn(env = process.env) {
	return /^(true|1)$/i.test(String(env.USE_REDDIT_OAUTH ?? "").trim());
}

// The instance's app ID, or null when USE_REDDIT_OAUTH is off or
// REDDIT_APP_ID isn't an app ID.
function getInstanceRedditAppId(env = process.env) {
	if (!isInstanceRedditOAuthOn(env)) return null;
	try {
		return normalizeRedditAppId(env.REDDIT_APP_ID);
	} catch {
		return null;
	}
}

module.exports = {
	forgetRedditOAuthToken,
	getInstanceRedditAppId,
	getRedditOAuthToken,
	isInstanceRedditOAuthOn,
	normalizeRedditAppId,
};

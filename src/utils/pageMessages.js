// The notes the sign-in page and the dashboard show from their address
// (?message=). The address carries only a code naming one of these, so a link
// can't put words of its own on a reddont page ("Your session expired, sign in
// at ...").
const LOGIN_MESSAGES = new Map([
	["session-expired", "Session expired"],
	["user-not-found", "User not found."],
	["database-error", "Database error."],
	["oidc-not-configured", "OIDC not configured"],
	["oidc-start-failed", "Failed to start OIDC login"],
	["oidc-session-expired", "OIDC session expired, try again"],
	["oidc-group-missing", "Not allowed (missing required group)"],
	["oidc-not-registered", "Account not registered"],
	["oidc-name-taken", "That username belongs to an account linked to another sign-in"],
	["oidc-failed", "OIDC login failed"],
]);

const DASHBOARD_MESSAGES = new Map([
	["saving-off", "Saving is turned off. Turn it on in your preferences."],
	["api-key-regenerated", "API key regenerated"],
	["api-key-regenerate-failed", "Failed to regenerate API key"],
	["api-key-revoked", "API key revoked"],
	["api-key-revoke-failed", "Failed to revoke API key"],
	["reddit-credential-invalid", "Invalid Reddit credential"],
	["reddit-app-id-invalid", "Invalid Reddit app ID"],
	[
		"reddit-app-no-token",
		"OAuth app saved, but Reddit didn't grant it a token. Check that the ID belongs to an installed app.",
	],
	["preferences-failed", "Failed to update preferences"],
	["user-updated", "User updated"],
	["user-deleted", "User deleted"],
	["user-delete-failed", "Failed to delete user. Try again."],
]);

function pick(messages, code) {
	const raw = Array.isArray(code) ? code[0] : code;
	return typeof raw === "string" ? messages.get(raw) : undefined;
}

function loginMessage(code) {
	return pick(LOGIN_MESSAGES, code);
}

function dashboardMessage(code) {
	return pick(DASHBOARD_MESSAGES, code);
}

module.exports = { DASHBOARD_MESSAGES, LOGIN_MESSAGES, dashboardMessage, loginMessage };

// reddont's cookies. Over HTTPS (secure cookies, the default) each name takes
// the __Host- prefix: a browser then accepts the cookie only from reddont's
// own host, over HTTPS, for the whole site. A page on another subdomain of the
// same domain can't set one, so it can't plant its own session, CSRF token or
// OIDC sign-in in flight (signing a visitor in to an account it controls).
// REDDONT_DISABLE_SSL=true serves plain HTTP, where browsers refuse prefixed
// cookies, so the names stay bare there.
const SECURE_COOKIES = process.env.REDDONT_DISABLE_SSL !== "true";
const PREFIX = SECURE_COOKIES ? "__Host-" : "";

module.exports = {
	SECURE_COOKIES,
	AUTH_COOKIE: `${PREFIX}auth_token`,
	CSRF_COOKIE: `${PREFIX}csrf_token`,
	OIDC_STATE_COOKIE: `${PREFIX}oidc_state`,
	OIDC_NONCE_COOKIE: `${PREFIX}oidc_nonce`,
	OIDC_VERIFIER_COOKIE: `${PREFIX}oidc_verifier`,
	OIDC_REDIRECT_COOKIE: `${PREFIX}oidc_redirect`,
	// A __Host- cookie has to cover the whole site.
	OIDC_COOKIE_PATH: SECURE_COOKIES ? "/" : "/auth/oidc",
};

// A minimal OpenID provider for tests. It answers through a fetch replacement,
// so openid-client performs its real discovery, PKCE, token, and userinfo
// exchanges without network access.
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const ISSUER = "https://idp.test";

// The authorization code carries the provider's answer, so a test in another
// process can choose the account without shared state. Fields:
//   nonce, codeChallenge   copied from the authorization request
//   claims                 extra ID token claims, including sub
//   userinfo               the userinfo response, or "fail" for a server error
//   refreshToken, expiresIn
function authorizationCode(details) {
	return Buffer.from(JSON.stringify(details)).toString("base64url");
}

function pkceChallenge(verifier) {
	return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function oauthError(error, status = 400) {
	return Response.json({ error }, { status });
}

function createFakeIdp({ clientId, clientSecret, onRequest = () => {} }) {
	const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
	const userinfo = new Map();

	function clientAuthentication(headers, body) {
		const basic = headers.get("authorization")?.match(/^Basic (.+)$/)?.[1];
		if (basic) {
			const [id, secret] = Buffer.from(basic, "base64").toString().split(":").map(decodeURIComponent);
			return { method: "client_secret_basic", valid: id === clientId && secret === clientSecret };
		}
		if (body.has("client_secret")) {
			const valid = body.get("client_id") === clientId && body.get("client_secret") === clientSecret;
			return { method: "client_secret_post", valid };
		}
		return { method: "none", valid: false };
	}

	function tokenResponse({ claims, nonce, userinfo: info, refreshToken, expiresIn = 3600 }) {
		const accessToken = crypto.randomBytes(16).toString("hex");
		const response = { access_token: accessToken, token_type: "Bearer", expires_in: expiresIn };
		if (claims) {
			userinfo.set(accessToken, info ?? { sub: claims.sub });
			response.id_token = jwt.sign({ ...claims, nonce }, privateKey, {
				algorithm: "RS256",
				audience: clientId,
				issuer: ISSUER,
				expiresIn: "5m",
				keyid: "test",
			});
		}
		if (refreshToken) response.refresh_token = refreshToken;
		return Response.json(response);
	}

	function token(body) {
		if (body.get("grant_type") === "authorization_code") {
			let grant;
			try {
				grant = JSON.parse(Buffer.from(body.get("code"), "base64url").toString());
			} catch {
				return oauthError("invalid_grant");
			}
			if (pkceChallenge(body.get("code_verifier") || "") !== grant.codeChallenge) {
				return oauthError("invalid_grant");
			}
			return tokenResponse(grant);
		}
		if (body.get("grant_type") === "refresh_token") {
			// "rotate-N" refresh tokens are replaced on use; others are kept.
			const refreshToken = body.get("refresh_token");
			if (refreshToken === "revoked") return oauthError("invalid_grant");
			const rotated = refreshToken.match(/^rotate-(\d+)$/);
			return tokenResponse({
				refreshToken: rotated ? `rotate-${Number(rotated[1]) + 1}` : undefined,
				expiresIn: 3600,
			});
		}
		return oauthError("unsupported_grant_type");
	}

	async function fetch(input, init = {}) {
		const url = new URL(input);
		const headers = new Headers(init.headers);
		const body = new URLSearchParams(init.body ?? "");
		const auth = url.pathname === "/token" ? clientAuthentication(headers, body) : null;
		onRequest({
			path: url.pathname,
			method: init.method || "GET",
			params: Object.fromEntries(body),
			clientAuthentication: auth?.method,
		});

		switch (url.pathname) {
			case "/.well-known/openid-configuration":
				return Response.json({
					issuer: ISSUER,
					authorization_endpoint: `${ISSUER}/authorize`,
					token_endpoint: `${ISSUER}/token`,
					userinfo_endpoint: `${ISSUER}/userinfo`,
					jwks_uri: `${ISSUER}/jwks`,
					response_types_supported: ["code"],
					subject_types_supported: ["public"],
					id_token_signing_alg_values_supported: ["RS256"],
					code_challenge_methods_supported: ["S256"],
					token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
				});
			case "/token":
				if (!auth.valid) return oauthError("invalid_client", 401);
				return token(body);
			case "/userinfo": {
				const info = userinfo.get(headers.get("authorization")?.replace(/^Bearer /, ""));
				if (!info) return oauthError("invalid_token", 401);
				if (info === "fail") return new Response("Unavailable", { status: 503 });
				return Response.json(info);
			}
			default:
				return new Response("Not found", { status: 404 });
		}
	}

	return { fetch };
}

module.exports = { ISSUER, authorizationCode, createFakeIdp, pkceChallenge };

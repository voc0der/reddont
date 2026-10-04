# Environment variables

Set these on the application process or under Compose's `environment:`.
Recreate a container after changing its environment. Values below describe
reddont 0.1.0; omit optional settings when unused instead of filling every
entry with an empty value.

## Server and storage

`REDDONT_PORT`
:   Listener port. Default: `3000`. Used for either HTTP or HTTPS.

`HTTP_BINDING`
:   Listener address. Default: `0.0.0.0`. Keep this inside Docker when other
    containers need to connect; restrict exposure using Docker's published ports.

`REDDONT_SSL_CERT_PATH` and `REDDONT_SSL_KEY_PATH`
:   Certificate and private-key paths, as seen by the app. No default.
    Both must be set to enable direct HTTPS. See [HTTPS](../deployment/reverse-proxy.md).

`REDDONT_DATA_DIR`
:   Explicit directory for `reddont.db`. Otherwise use `/data` if it exists,
    then `$XDG_DATA_HOME/reddont`, then `~/.local/share/reddont`.

`XDG_DATA_HOME`
:   Base data directory for a non-container installation when neither
    `REDDONT_DATA_DIR` nor `/data` takes precedence.

`PUID` and `PGID`
:   Container runtime user and group IDs. Default: `1000` for each. Used by
    the image entrypoint; they do not change the user of a directly launched Bun process.

## Login and proxy settings

`JWT_SECRET_KEY`
:   Persistent session-signing secret, also used to derive the encryption key
    for OIDC refresh tokens. Default: randomly generated on each start.

`REDDONT_DISABLE_SSL`
:   Default: secure login cookies. The exact value `true` removes their
    Secure flag for HTTP-only deployments. It does not disable the HTTPS listener.

`REMOTE_HEADER_LOGIN`
:   Enable remote header SSO with `true` or `1`. Default: disabled when
    unset. Leave unset when unused; a nonempty `false` still enables the
    server's forwarded-request trust setup.

`ADMIN_GROUP`
:   Administrator group for remote header login. Default: `admin`.

`REVERSE_PROXY_WHITELIST`
:   Comma-separated trusted direct proxy IPs. Default: unset. When proxy
    handling is active and this is empty, Express trusts one hop. Header SSO
    independently accepts only loopback or explicitly listed IPs, not CIDRs.
    This setting does not configure API access.

See [accounts](../administration/accounts.md), [SSO](../administration/sso.md),
and [reverse proxies](../deployment/reverse-proxy.md).

## API

`API_WHITELIST`
:   Default when unset or empty: `127.0.0.1,::1`. Accepts comma-separated IPs
    and IPv4/IPv6 CIDRs. `off` disables access; `*` allows all source addresses.
    The check uses the direct TCP peer, not forwarded headers. Keys are still
    required for all endpoints except the whitelisted health probe.

`API_RATE_LIMIT`
:   Maximum API requests per 15-minute window per direct peer address.
    Default: `600`. Use a positive integer.

See [API and feeds](api.md).

## OpenID Connect

`OIDC_ENABLED`
:   Default: disabled. `true`, `1`, or `yes` enables initialization. The
    required settings below must be present and provider discovery must succeed.

`OIDC_ISSUER_URL`
:   Provider issuer URL. Required when OIDC is enabled; no default.

`OIDC_CLIENT_ID`
:   Registered client identifier. Required when OIDC is enabled; no default.

`OIDC_CLIENT_SECRET`
:   Registered client secret. Required by the current initialization path;
    no default.

`OIDC_REDIRECT_URI`
:   Public callback URL, for example
    `https://reddont.example.com/auth/oidc/callback`. Required; no default.

`OIDC_SCOPE`
:   Requested scopes. Default: `openid profile email`. Add provider-supported
    scopes for group claims or refresh tokens as needed.

`OIDC_CLIENT_AUTH_METHOD`
:   Default: `client_secret_post`. Match your provider's token endpoint
    authentication method. The implementation also recognizes
    `client_secret_basic`, `client_secret_jwt`, `private_key_jwt`, and `none`,
    but still requires a client secret and does not expose private-key
    configuration. Prefer a confidential client with a shared-secret method.

`OIDC_AUTO_REGISTER`
:   Default when omitted: `true`. Create users whose identity does not match
    an existing account. `false` disables creation; matching local usernames
    can still be linked. Use `true`/`false` or `1`/`0`; an empty value is false.

`OIDC_FIRST_USER_ADMIN`
:   Default when omitted: `true`. Grant admin at the first OIDC login on an
    empty database. Subsequent logins calculate the role from claims.
    An empty value is false.

`OIDC_GROUP_CLAIM`
:   Claim path used to extract groups. Falls back to `OIDC_ADMIN_CLAIM` when
    supplied, otherwise `groups`. Supports dotted paths and simple indexes.

`OIDC_ADMIN_CLAIM`
:   Claim path used for administrator matching. Falls back to
    `OIDC_GROUP_CLAIM`, otherwise `groups`.

`OIDC_ADMIN_VALUE`
:   Value identifying administrators. Default: `admin`. Matching is
    case-insensitive against the admin claim and extracted groups.

`OIDC_ALLOWED_GROUPS`
:   Comma-separated permitted groups. Default: no additional group restriction.
    A user must match at least one when configured; matching is case-insensitive.

## Appearance and logging

`REDDONT_THEME`
:   Optional stylesheet name in `src/public`, without `.css`. Default: unset.
    Separate from each user's theme preference.

`LOG_LEVEL`
:   `debug`, `info`, `warn`, or `error`. Default: `info`. Inspect logs before
    sharing them, especially when debug logging authentication flows.

`RATE_LIMIT`
:   Browser request limit per 15-minute window per IP. Default: `100`.
    API requests use their separate limit. Use a positive integer.

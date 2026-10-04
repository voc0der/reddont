# Single sign-on

reddont supports OpenID Connect and authentication headers from a trusted
reverse proxy. Configure one login path first, verify it, then add any
fallbacks you need.

At `/login`, configured OIDC takes priority, followed by trusted remote
headers, then the local password form.

## OpenID Connect

Create a confidential client in your identity provider with this callback:

```text
https://reddont.example.com/auth/oidc/callback
```

Use your instance's real public hostname. Set these environment variables
alongside a persistent `JWT_SECRET_KEY`:

```yaml
environment:
  OIDC_ENABLED: "true"
  OIDC_ISSUER_URL: "https://auth.example.com/application/o/reddont/"
  OIDC_CLIENT_ID: "reddont"
  OIDC_CLIENT_SECRET: "${OIDC_CLIENT_SECRET}"
  OIDC_REDIRECT_URI: "https://reddont.example.com/auth/oidc/callback"
  OIDC_SCOPE: "openid profile email"
  OIDC_CLIENT_AUTH_METHOD: "client_secret_post"
  OIDC_AUTO_REGISTER: "true"
  OIDC_FIRST_USER_ADMIN: "false"
  OIDC_GROUP_CLAIM: "groups"
  OIDC_ADMIN_CLAIM: "groups"
  OIDC_ADMIN_VALUE: "admin"
  OIDC_ALLOWED_GROUPS: "reddont-users,admin"
  REVERSE_PROXY_WHITELIST: "172.30.0.2"
```

The issuer URL and proxy IP above are examples. Use the issuer URL provided
by your identity provider and the direct proxy address seen by reddont.
Keep the client secret in your deployment's `.env` or secret management.
The default client authentication method is `client_secret_post`; configure
the provider to match. The app uses authorization code flow with PKCE.

Recreate the container, check the logs for successful OIDC initialization,
and visit `/login`. Discovery or configuration failures leave local login
available and are reported in the logs.

### Groups and administrator access

`OIDC_GROUP_CLAIM` extracts groups from the identity claims. Claim paths can
use dots and simple indexes, such as `realm_access.roles` or `groups[0]`.
If `OIDC_ALLOWED_GROUPS` is set, the user must match at least one listed group.
Omitting it imposes no additional group restriction in reddont.

Administrator status is computed from `OIDC_ADMIN_CLAIM` and extracted groups
using `OIDC_ADMIN_VALUE`, and is updated during login. By default,
`OIDC_FIRST_USER_ADMIN=true` also grants admin status to the first user on an
empty instance at that initial login. The example disables that exception
and uses the provider's `admin` group instead.

### Existing accounts and registration

When an OIDC identity is not already linked, a matching local username can
be linked automatically. Use a trusted provider with controlled usernames.
`OIDC_AUTO_REGISTER=false` stops new account creation, but does not disable
linking to an existing matching username.

Keep `JWT_SECRET_KEY` stable. OIDC refresh tokens are encrypted using a key
derived from it. Include `offline_access` in `OIDC_SCOPE` only when supported
and required by your provider to issue refresh tokens.

### Local login fallback

Use `/login?bypass_oidc=true` to skip the automatic OIDC redirect. A local
password account can use this route if it has a known password. Trusted
remote header login can still take precedence there; the parameter bypasses
only OIDC.

## Remote header authentication

An authentication proxy can supply the identity after it has authenticated
the request. For example:

```yaml
environment:
  REMOTE_HEADER_LOGIN: "true"
  ADMIN_GROUP: "admin"
  REVERSE_PROXY_WHITELIST: "172.30.0.2"
```

The proxy should set `Remote-User` to the authenticated username and
`Remote-Groups` to a comma-separated group list. The application also accepts
the header names `http_auth_user` and `http_remote_groups`.

Only loopback and explicitly listed direct proxy IPs are accepted for header
login. Use individual IP addresses for `REVERSE_PROXY_WHITELIST`: the header
authentication check does not expand CIDR ranges. This is different from
`API_WHITELIST`, which does support CIDRs.

reddont creates a local user on the first successful header login. Membership
in `ADMIN_GROUP` grants administrator access. Send a consistent, nonempty
group list when managing roles; the current synchronization path skips
group updates when it receives an empty list.

!!! warning "Trust only your authentication proxy"

    Have the proxy replace incoming identity headers with its own values,
    and restrict direct access to the app. Loopback is trusted as well, so a
    local forwarding proxy must not pass arbitrary client identity headers.

See [reverse proxy and HTTPS](../deployment/reverse-proxy.md) and the full
[environment reference](../reference/environment.md).

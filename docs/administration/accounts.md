# Accounts and invites

Each reddont account has its own subscriptions, preferences, optional Reddit
credential, and API key. Accounts can use a local password or
[single sign-on](sso.md).

## First administrator

On an empty database, visit `/register` and create an account. That first
password account becomes an administrator without needing an invite. Complete
this step before sharing the instance's address.

After the first account exists, password registration requires a valid,
unused invite. An instance unexpectedly offering first-user registration
usually means it is reading a new or empty database; check the data mount
before creating another account.

## Invite someone

1. Sign in as an administrator and open your dashboard.
2. Choose **create invite**.
3. Copy the complete registration link from the invites table.
4. Send the link to the person who should join.

Each invite can be claimed once. The table shows its creation and claim
status. Delete an unused invite to withdraw it. Deleting a claimed invite
does not delete the account created with it.

Administrators can delete any invite. Anyone else can delete only the invites
they created, which happens when an administrator who made invites loses the
role: their dashboard still lists those invites. Invites made before 0.1.17
record no creator, so only administrators can delete them.

## Sessions

Local login sessions last five days. Set a persistent `JWT_SECRET_KEY` so a
server restart does not invalidate them. Changing that secret invalidates
existing sessions and affects stored OIDC refresh tokens.

For HTTP-only access, `REDDONT_DISABLE_SSL=true` allows the login cookie to
be sent without HTTPS. Leave it unset or `false` when the browser uses HTTPS,
including when TLS terminates at a reverse proxy.

Over HTTPS the session cookie is `__Host-auth_token`, and the CSRF and OIDC
cookies carry the same `__Host-` prefix. Browsers accept these only from
reddont's own host, so a site on another subdomain of the same domain can't
set them to sign a visitor in to an account it controls. Updating from 0.1.16
or earlier signs everyone out once.

## Failed sign-ins

reddont stops checking passwords from an address after 10 failed sign-ins for
one username, or 30 for any usernames, within 15 minutes. An IPv6 address
counts by its /56, as with `RATE_LIMIT`. Until the 15
minutes from the first failure are up, that address's sign-ins (for that
username) are refused, even with the right password. A successful sign-in
clears its username's count. Each failure is logged as a warning naming the
username and the address, for tools such as fail2ban.

Behind a reverse proxy, set `REVERSE_PROXY_WHITELIST` to the proxy's address
so these limits count each client rather than the proxy; see
[reverse proxy and HTTPS](../deployment/reverse-proxy.md).

## SSO accounts

Remote header login provisions users from the authenticated proxy username.
OIDC can automatically create users and map administrator access from claims.
These account-creation paths do not require password-registration invites.
Use your identity provider and the SSO settings to control who can join.

See [single sign-on](sso.md) for claim mapping, trusted proxies, and the
first-user administrator option.

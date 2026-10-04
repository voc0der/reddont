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

## Sessions

Local login sessions last five days. Set a persistent `JWT_SECRET_KEY` so a
server restart does not invalidate them. Changing that secret invalidates
existing sessions and affects stored OIDC refresh tokens.

For HTTP-only access, `REDDONT_DISABLE_SSL=true` allows the login cookie to
be sent without HTTPS. Leave it unset or `false` when the browser uses HTTPS,
including when TLS terminates at a reverse proxy.

## SSO accounts

Remote header login provisions users from the authenticated proxy username.
OIDC can automatically create users and map administrator access from claims.
These account-creation paths do not require password-registration invites.
Use your identity provider and the SSO settings to control who can join.

See [single sign-on](sso.md) for claim mapping, trusted proxies, and the
first-user administrator option.

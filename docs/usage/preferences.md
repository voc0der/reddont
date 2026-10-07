# Preferences and credentials

Select your username to open `/dashboard`. Preferences apply to your account,
so other people on the same instance can use different settings.

## Reading preferences

| Setting | Default | Effect |
| --- | --- | --- |
| Never Ending Reddit | Off | Load more feed posts and comments as you scroll. |
| High Resolution Thumbnails | On | Request higher-quality preview images and video thumbnails. |
| Don't hide thumbnails for 18+ content | Off | Reveal adult-content thumbnails by default. |
| Theme Preference | Auto | Follow the system theme, or choose Light, Dark, or RES Night Mode. |

Choose **Save Preferences** after editing. Disabling high-resolution
thumbnails can help on limited connections. On desktop, Dark and RES Night
Mode both use RES's night mode colors and Light uses old reddit's; on a phone,
Dark follows reddit's own dark theme.

## Reddit credentials

The dashboard's **reddit authentication - burner account only** section can
store a Reddit credential for requests made on your behalf. Use a separate
account as indicated by the interface.

Choose one of the supported forms:

- **Auto-detect**: recognize a cookie or authorization header.
- **Cookie header**: paste a full `Cookie: ...` header.
- **reddit_session cookie**: supply that cookie's value.
- **Bearer token**: supply a token or `Authorization: Bearer ...` header.

Paste the value into **Reddit Credential** and save. The status text reports
whether a credential is configured. Leaving the field empty preserves the
current value; use **Clear saved Reddit credential** to remove it.

If a feed fails without authentication, a landing page links directly to this
section so you can add a credential. Empty feeds that load successfully do not
show this page.

**Allow other users on this instance to fall back to my Reddit cookie** is off
by default. Enable it and save to let signed-in users without their own Reddit
authentication use your cookie for browser and API requests. Their requests
run under your Reddit account, but the cookie value is never shown to them.
Bearer tokens are not shared. If several users share cookies, the cookie from
the oldest user account with a usable shared cookie is selected.

A user's own saved credential always takes priority, including bearer tokens.
To stop sharing, uncheck the option, clear the credential, or replace it with
a bearer token. The change applies to subsequent requests.

These credentials belong to Reddit. They are separate from your reddont
password, SSO login, and personal API key. API requests reuse the key owner's
saved Reddit credential, fall back to a shared cookie when none is saved, or
request content anonymously when neither is available.

Reddit credentials can expire. If feeds stop working, replace the saved
credential or clear it and retry. The app does not provide an interactive
Reddit login or automatically renew a supplied cookie or bearer token.

## Personal API key

Under **api key**, select **Generate key** to create a `reddont_` key. You can
regenerate it to invalidate the old value or revoke it entirely. The dashboard
also shows the instance's allowed API source addresses.

See [API and feeds](../reference/api.md) for request examples and endpoint
formats.

## Stored credentials

The SQLite database contains personal API keys and Reddit credentials.
Protect access to its directory and backups. OIDC refresh tokens are
encrypted using a key derived from `JWT_SECRET_KEY`; this does not mean the
whole database is encrypted.

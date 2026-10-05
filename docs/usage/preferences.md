# Preferences and credentials

Select your username to open `/dashboard`. Preferences apply to your account,
so other people on the same instance can use different settings.

## Reading preferences

| Setting | Default | Effect |
| --- | --- | --- |
| Never Ending Reddit | Off | Load more feed posts as you scroll. |
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

These credentials belong to Reddit. They are separate from your reddont
password, SSO login, and personal API key. API requests reuse the key owner's
saved Reddit credential; without one, they request content anonymously.

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

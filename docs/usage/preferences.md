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

Reddit blocks requests without a signed-in session. Give reddont a
`reddit_session` cookie from a burner account:

1. In a private window, sign in to <https://www.reddit.com> with the burner
   account.
2. Open developer tools (F12), then **Application** in Chrome or Edge, or
   **Storage** in Firefox.
3. Under **Cookies**, select `https://www.reddit.com` and copy the value of
   `reddit_session`. Close the window without signing out.
4. In reddont, select your username. Under **reddit authentication**, set
   **Credential Type** to **reddit_session cookie**, paste the value into
   **Reddit Credential**, and choose **Save Preferences**.

The section then shows `Current: cookies (reddit_session)`. When the cookie
expires, feeds fail again; repeat these steps.

**Credential Type** also accepts a full `Cookie:` header or a bearer token.
Saving with the field empty keeps the stored credential; **Clear saved Reddit
credential** removes it.

### Reddit OAuth app

Instead of a cookie, or beside one, reddont can use a Reddit OAuth app, as
teddit's `use_reddit_oauth` does: it asks Reddit for the app's token, which
isn't signed in to any account, and reads oauth.reddit.com with it.

1. Signed in to Reddit, open <https://old.reddit.com/prefs/apps/> and choose
   **create another app**. Select **installed app**, enter a name, and enter
   any redirect URI, such as `http://localhost`; reddont doesn't use it.
2. Copy the app's ID, the string under its name.
3. In reddont, paste it into **Reddit OAuth App ID** under **reddit
   authentication** and choose **Save Preferences**.

The section then shows `Current app: app ID ending in` and the ID's last four
characters. If Reddit doesn't grant the app a token, the dashboard says so
after saving. Tokens last a day and are renewed before they expire. Saving with the
field empty keeps the stored app; **Clear saved OAuth app** removes it.

With a credential and an app both saved, **Try First** chooses which one
requests use. When Reddit refuses it or sends nothing usable, reddont repeats
the request with the other.

### Sharing

**Allow other users on this instance to fall back to my Reddit cookie** lets
signed-in users without their own credential or app use your cookie,
including through their API keys. Their requests run under your Reddit
account; they never see the cookie. Bearer tokens are never shared.

**Allow other users on this instance to fall back to my OAuth app** does the
same for your app, whose token belongs to no Reddit account. Users who fall
back to what you share get your **Try First** order. With several sharers, the
oldest account's shared cookie and app are used, and one it doesn't share
comes from the next account that does.

### The instance's OAuth app

An administrator can give the whole instance an OAuth app with
`USE_REDDIT_OAUTH` and `REDDIT_APP_ID`, teddit's settings (see
[environment variables](../reference/environment.md#reddit)). Users without
their own cookie or app use it first, then what other users share. Everyone
else falls back to it after their own. **Requests use**, under **reddit
authentication**, lists the order your requests follow.

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

# Troubleshooting

Start with `docker compose logs --tail=100 reddont`, or the terminal output
when running Bun directly. Note the deployment method, image version, and
which page or request fails. Remove credentials from logs before sharing them.

## Login returns to the login screen

- On HTTP, set `REDDONT_DISABLE_SSL=true` and recreate the container.
- On HTTPS, keep secure cookies enabled and verify the public scheme and proxy headers.
- Set a persistent `JWT_SECRET_KEY` if sessions disappear after restarts.
- Clear stale site cookies after changing the public address or authentication setup.

For **Invalid CSRF token**, reload the form so its token and cookie match,
then submit again. See [HTTPS setup](../deployment/reverse-proxy.md).

## Registration needs an invite

This is expected once an account exists. Ask an administrator to create an
invite from the dashboard. An invalid or already-claimed invite cannot be
reused. See [accounts and invites](../administration/accounts.md).

If an established instance suddenly offers first-user registration, check
that it has the correct database mount before creating anything.

## OIDC does not start or returns an error

Check the required OIDC variables, provider discovery URL, client secret,
and exact callback URL. The logs report initialization failures. Confirm
that the provider sends the configured group claims and that the user matches
`OIDC_ALLOWED_GROUPS` when configured.

For missing state or session cookies, check HTTPS, the external hostname,
and forwarded scheme. Try `/login?bypass_oidc=true` with a known local password
account. See [SSO](../administration/sso.md).

## Remote header login is ignored

Set `REMOTE_HEADER_LOGIN=true`. Confirm that the proxy supplies `Remote-User`
and that its direct IP is listed in `REVERSE_PROXY_WHITELIST`. Use individual
IPs, not CIDRs. Requests from an untrusted address are intentionally ignored.

## The API returns 403 or 401

A `403` happens before key validation: inspect `API_WHITELIST` and the source
IP logged by the app. Docker and proxies can change that address. A working
browser session does not grant API network access.

A `401` means the address gate passed but the key is missing or invalid.
Check `/api/v1/health` first, then `/api/v1/whoami` with `X-API-Key`. If a key
was regenerated, update every client using it.

See [API and feeds](api.md).

## Empty feeds, upstream errors, or rate limits

Check whether the same community or post is available on Reddit. Review the
upstream request logs. If you saved a Reddit credential, it may have expired;
replace it or clear it from the dashboard and retry.

When a failed feed has no authentication available, use **Add Reddit
authentication** on the landing page to open the dashboard's Reddit settings.
Save a cookie or bearer token from a signed-in burner account, a Reddit OAuth
app's ID, or both. A user can also share their cookie and app with other users
on the instance who have neither; see
[preferences and credentials](../usage/preferences.md#reddit-credentials).

With an OAuth app or a bearer token, requests go to oauth.reddit.com, which
serves the same JSON without the `.json` extension, and an app's token comes
from `www.reddit.com/api/v1/access_token`; allow both hosts if outbound traffic
is restricted. When Reddit won't grant an app a token, the log shows
`Reddit refused an OAuth token request` with the status (401 for an ID that
isn't an installed app's), and reddont waits a minute before asking again.
With a credential and an app both saved, a request Reddit refuses one way is
repeated the other way.

With a Reddit cookie, every request to Reddit goes to old.reddit.com instead
of www.reddit.com; allow both hosts if outbound traffic is restricted. Reddit
blocks its JSON feeds and post search for cookie sessions, so with a cookie a
feed or search reads the order of posts from old reddit's page and loads the
posts from `/api/info.api`. Reddit also blocks `/api/info.json` and
`/api/morechildren.json` for cookie sessions, so reddont requests their `.api`
versions, which return the same JSON; **load more comments** uses
`/api/morechildren.api`. old reddit redirects a feed of several
communities, such as the home feed, to their canonical spelling; reddont
follows that redirect and requests the canonical page directly afterwards.
When Reddit refuses a feed, search, comments, or load-more request, the log
shows `Reddit refused a feed request` (or `search`, `comments`, `load-more`)
with the host and HTTP status, and for a redirect reddont doesn't follow, such
as to the login page, its `location`. If Reddit answers with a page that holds
no listing, the log shows `Reddit sent a feed page without a listing` (or
`search`).

The app's browser limit defaults to 100 requests per 15 minutes; the API
defaults to 600. These are separate from upstream rate limits. Slower polling
can help. A higher local limit does not remove an upstream restriction.

## Data is missing or the database cannot be opened

Check the host volume path, `REDDONT_DATA_DIR`, and permissions for `PUID` and
`PGID`. Outside Docker, also check the account running Bun and its home
directory. The app chooses a data path at startup; an empty path produces a
new database instead of finding data elsewhere.

Restore a backup only after stopping the app. See
[backups and updates](../deployment/maintenance.md).

## Video or thumbnails will not load

Try reopening the post and checking the same content upstream. Test a current
browser with its normal media permissions, and inspect any browser content
blocking. Turning off high-resolution thumbnails reduces preview bandwidth.
Some media is fetched directly by the browser, so its network access matters
as well as the server's.

## An installed app shows old pages

Reload, close and reopen it, or clear that instance's site data to reset its
service worker and cached resources. Clearing site data signs you out.
See [install as an app](../usage/pwa.md).

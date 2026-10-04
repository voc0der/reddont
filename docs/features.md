# Features

reddont brings Reddit's public feeds and discussions into an interface you
host yourself. Browsing requires a local reddont account or SSO; connecting
a Reddit account is optional.

## Reading

- Desktop compact and card views, plus a phone layout with a navigation drawer.
- Home feed built from your subscriptions, with shortcuts to popular and all.
- Subreddit and post search, sorting, and pagination.
- Optional infinite scrolling.
- Inline text, image, gallery, and video previews, including crossposts.
- Collapsible comments and single-comment thread views.
- Hidden spoiler and adult-content previews, with an adult-thumbnail preference.

See [browsing and subscriptions](usage/browsing.md).

## Personal preferences

- System, light, dark, and RES night themes.
- Optional classic desktop layout.
- High-resolution thumbnails that can be disabled to reduce bandwidth.
- Installable Progressive Web App with an offline fallback page.
- Per-user Reddit cookie or bearer-token settings for upstream requests.

See [preferences and credentials](usage/preferences.md) and
[installing the app](usage/pwa.md).

## Running an instance

- SQLite storage in one persistent data directory.
- First-account administrator setup, followed by invite-only registration.
- OpenID Connect with PKCE and group-based access controls.
- Remote header authentication through a trusted proxy.
- HTTP or direct HTTPS, with configurable request limits.
- Docker images for Linux amd64 and arm64.

See [Docker and storage](deployment/docker.md),
[accounts](administration/accounts.md), and [SSO](administration/sso.md).

## Feeds and automation

Each user can generate a personal API key. The read-only API provides JSON
and Atom feeds for posts, comments, home subscriptions, and searches. API
access also has a source-address allowlist and its own request limit.

See the [API reference](reference/api.md).

## Boundaries

reddont does not post, vote, or comment on Reddit. Subscriptions are stored
locally and do not synchronize with a Reddit account. It also depends on
Reddit being reachable: upstream restrictions, expired credentials, and
rate limits can interrupt feeds or media.

The client is not an anonymity proxy. Media, outbound links, and some assets
can be fetched directly by your browser. The PWA's cache is not a complete
offline archive.

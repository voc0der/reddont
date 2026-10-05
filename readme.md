# reddont

A self-hosted, read-only Reddit client with personal subscriptions, desktop and
mobile layouts, single sign-on, and an API for JSON and Atom feeds.

**[Documentation](https://voc0der.github.io/reddont/)** ·
[Quick start](https://voc0der.github.io/reddont/getting-started/quick-start/) ·
[API reference](https://voc0der.github.io/reddont/reference/api/) ·
[Changelog](CHANGELOG.md)

## Features

- Old reddit and RES on desktop, reddit's mobile layout on phones, threaded
  comments, inline previews, and optional infinite scrolling.
- Per-user subscriptions, themes, thumbnail settings, and optional Reddit credentials.
- Invite-only accounts after initial administrator setup, plus OIDC and trusted proxy SSO.
- Installable Progressive Web App.
- Personal API keys, JSON responses, and Atom feeds with source-address access controls.
- SQLite storage and Docker images for Linux amd64 and arm64.

Browsing requires a reddont account. A Reddit account is optional. reddont does
not post, vote, or comment on Reddit.

## Run it

The container image is `ghcr.io/voc0der/reddont:latest`; the initial version is
`0.1.0`. Follow the [Docker quick start](docs/getting-started/quick-start.md) to
create a persistent data mount, set a session secret, and register the first
administrator. The full environment example is in [docker-compose.yaml](docker-compose.yaml).

For local development with [Bun](https://bun.sh/):

```sh
bun install --frozen-lockfile
REDDONT_DATA_DIR="$PWD/.local-data" REDDONT_DISABLE_SSL=true HTTP_BINDING=127.0.0.1 bun run src/index.js
```

Open `http://localhost:3000/register`. See the
[development guide](docs/development/index.md) for the source layout and tests.

## Documentation

The [Zensical documentation](https://voc0der.github.io/reddont/) covers setup,
usage, SSO, configuration, the API, and maintenance. Its source lives in
[docs/](docs/index.md). For local preview and strict build commands, see
[working on the documentation](docs/development/documentation.md).

## License

[MIT](LICENSE). Based on [Akshay Oppiliappan](https://github.com/oppiliappan)'s
Reddit client, with thanks for their work.

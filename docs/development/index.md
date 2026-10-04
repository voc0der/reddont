# Local development

The application uses Bun, Express, Pug templates, and SQLite. No frontend
bundle step is required to run it; Pug templates render on the server.

## Run with Bun

Install [Bun](https://bun.sh/), then:

```sh
git clone https://github.com/voc0der/reddont.git
cd reddont
bun install --frozen-lockfile
REDDONT_DATA_DIR="$PWD/.local-data" \
  REDDONT_DISABLE_SSL=true \
  HTTP_BINDING=127.0.0.1 \
  bun run src/index.js
```

Open <http://localhost:3000/register> for a fresh database. This gives
development its own data directory. Set `JWT_SECRET_KEY` in your local
environment if you want sessions to survive restarts.

`REDDONT_PORT` changes the listener port. Set any credentials through local
environment configuration, and keep them out of source control.

## Tests

```sh
bun test
```

The suite covers Reddit credential parsing, API access controls and routes,
Atom feeds, self-text decoding, and post rendering. API integration tests
open a temporary localhost server and use a temporary SQLite database.
Run in an environment that permits binding a local port.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/index.js` | Server startup, request middleware, CSRF, rate limits, and TLS. |
| `src/routes/index.js` | Browser routes, account setup, preferences, and SSO callbacks. |
| `src/routes/api.js` | Read-only JSON and feed endpoints. |
| `src/db.js` | SQLite schema, data path, and migrations. |
| `src/auth.js`, `src/oidc.js`, `src/apiAuth.js` | Browser sessions, OIDC, and API authorization. |
| `src/geddit.js`, `src/redditAuth.js` | Upstream requests and per-user Reddit credentials. |
| `src/views/`, `src/mixins/` | Pug pages and reusable UI. |
| `src/public/` | Styles and service worker. |
| `src/utils/` | Feed serialization, HTML decoding, and generated app icon. |

## Nix

The repository also contains `flake.nix`, with a development shell,
`reddont` package, default app, and NixOS module. Enter the development shell
with `nix develop`; the direct Bun workflow above is the simplest way to work
on the app.

The package's dependency derivation has a fixed output hash. Dependency or
lockfile changes may require updating that hash and validating a full Nix
build. A successful Bun test run alone does not verify Nix packaging.

## Making changes

Keep database changes in the migration mechanism and preserve existing data.
Run the relevant tests after changing routes, authentication, or rendering.
For container changes, also validate `docker compose config` and build the
Dockerfile.

Update the corresponding documentation when changing an environment
variable, route, or UI setting. See [working on the docs](documentation.md).

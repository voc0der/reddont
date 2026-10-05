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
Atom feeds, self-text decoding, post rendering, and the app icons. API
integration tests open a temporary localhost server and use a temporary SQLite
database. Run in an environment that permits binding a local port.

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
| `src/public/` | Shared `styles.css`, phone `mobile.css`, desktop `desktop.css`, the service worker, the web app manifest, and icons. |
| `src/utils/` | Feed serialization and HTML decoding. |
| `branding/` | The logo's vector sources, wordmarks, and PNG sizes. |

## Nix

The repository also contains `flake.nix`, with a development shell,
`reddont` package, default app, and NixOS module. Enter the development shell
with `nix develop`; the direct Bun workflow above is the simplest way to work
on the app.

The package's dependency derivation has a fixed output hash. Dependency or
lockfile changes, including Renovate's, may require updating that hash and
validating a full Nix build. A successful Bun test run alone does not verify
Nix packaging.

## Dependency updates

[Renovate](https://docs.renovatebot.com/) runs from
[`.github/workflows/renovate.yml`](https://github.com/voc0der/reddont/blob/main/.github/workflows/renovate.yml),
configured in
[`.github/renovate.json5`](https://github.com/voc0der/reddont/blob/main/.github/renovate.json5).
It runs hourly, after every push to `main`, and when a pull request check
finishes on a `renovate/*` branch. It keeps Bun packages, GitHub Actions, and
the documentation dependency up to date.

- Minor and patch updates share one pull request, which merges on its own
  once its checks pass and the release is 3 days old.
- Majors wait for approval on the Dependency Dashboard issue.
- A daily lockfile refresh updates indirect dependencies and also merges on
  its own.
- Security fixes skip the wait. Renovate opens them from the repository's
  Dependabot alerts and from osv.dev.

Renovate signs in as a GitHub App through the `RENOVATE_APP_CLIENT_ID`
variable and the `RENOVATE_APP_PRIVATE_KEY` secret. Dependabot alerts, secret
scanning, and push protection are set under the repository's
**Settings > Security**.

## Making changes

Keep database changes in the migration mechanism and preserve existing data.
Run the relevant tests after changing routes, authentication, or rendering.
For container changes, also validate `docker compose config` and build the
Dockerfile.

Update the corresponding documentation when changing an environment
variable, route, or UI setting. See [working on the docs](documentation.md).

# Working on the documentation

These pages use [Zensical](https://zensical.org/docs/), with the same TOML
layout and GitHub Pages workflow used by Coldarr. Content lives in `docs/`;
navigation, theme, and link validation live in `zensical.toml`.

## Install the tools

From the repository root, create a separate Python environment and install
the pinned release:

```sh
python3 -m venv .venv-docs
. .venv-docs/bin/activate
python -m pip install -r requirements-docs.txt
```

Use Python 3.10 or newer; CI uses Python 3.14. On Windows, activate the
environment with `.venv-docs\Scripts\activate`. The app itself still runs
with Bun; Python is only needed to build documentation.

## Preview and build

```sh
zensical serve
```

Open the local address printed by the server, normally
<http://localhost:8000>. Check edited pages at desktop and mobile widths,
including both light and dark themes.

Before publishing, run:

```sh
zensical build --clean --strict
```

The build writes `site/` and fails on warnings, including invalid links and
heading anchors. Generated output, the Python environment, and build caches
are ignored by Git and excluded from the app's Docker context. See
[Zensical's build options](https://zensical.org/docs/usage/build/).

## Regenerating screenshots

The README cover and [gallery](../gallery.md) are captured from the real app with fictional content. From the repository root, run:

```sh
bun install --frozen-lockfile
./dev/screenshots/gallery.sh
```

The harness needs Bun, Node.js 20 or newer, and npm. On its first run it installs the pinned Playwright dependency in `dev/screenshots/` and downloads Chromium. On Linux, install browser system dependencies if needed with `cd dev/screenshots && npx playwright install --with-deps chromium`. Set `CHROMIUM_PATH` to use an existing Chromium executable instead.

Each run starts the current app on a random loopback port with a temporary SQLite database, fictional accounts, and fixed dates. Upstream responses and browser media requests use checked-in fixtures; unexpected requests fail the capture. No upstream account or existing application database is used. The server and temporary files are cleaned up when the run finishes.

All 11 images are written to `docs/assets/screenshots/` after the captures pass checks for missing images, browser errors, and horizontal overflow. Review and commit them alongside interface changes. The capture is a manual development tool and does not run in CI.

Edit the sample posts and comments in `dev/screenshots/fixtures/content.cjs`; the SVG illustrations alongside it are original fixture artwork. Capture routes, themes, and viewport sizes live in `dev/screenshots/gallery.mjs`. Keep the filenames and image dimensions in [gallery.md](../gallery.md) aligned with the harness.

## Authoring

- Add each page to `nav` in `zensical.toml`.
- Link to pages with relative Markdown paths, such as `../reference/api.md`.
- Give code blocks a language, and use tabs for alternative examples.
- Keep environment defaults and API formats aligned with the source code.
- The compose example, changelog, and license are included from their root
  files with snippets, so edits do not need to be copied into docs.
- Store deliberately published assets under `docs/assets/`. Local reference
  screenshots remain ignored; they are not inputs to the docs build.
- Link to repository source with full GitHub URLs when it is outside `docs/`.

## Publishing

[`.github/workflows/docs.yml`](https://github.com/voc0der/reddont/blob/main/.github/workflows/docs.yml)
builds documentation changes in pull requests and uploads a preview artifact.
Successful builds on `main` deploy to GitHub Pages. Pull requests do not deploy.
The workflow can also be run manually on `main`.

The production address is <https://voc0der.github.io/reddont/>. A new fork
must enable **Settings > Pages > Build and deployment > Source > GitHub
Actions**, then update `site_url`, repository links, and edit links in the
configuration. This follows
[Zensical's publishing setup](https://zensical.org/docs/publish-your-site/).

Renovate picks up the Zensical pin in `requirements-docs.txt` and folds its
updates into the usual minor and patch group. That pull request changes the
requirements file, so the strict build runs on it, and a release that breaks
the build can't merge on its own.

Dependabot checks the Zensical pin in `requirements-docs.txt`. Its updates
run through the same strict docs build. Pip downloads may be cached in CI;
Zensical's generated output is rebuilt cleanly each time.

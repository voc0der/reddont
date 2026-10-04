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

Dependabot checks the Zensical pin in `requirements-docs.txt`. Its updates
run through the same strict docs build. Pip downloads may be cached in CI;
Zensical's generated output is rebuilt cleanly each time.

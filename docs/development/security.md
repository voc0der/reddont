# Security scans

Each of these workflows fails on findings. Fix a finding where you can; each
tool's way to record a reviewed false positive is described below. Renovate
merges its own pull requests only once every check passes, so add any new
workflow that runs on pull requests to the `workflow_run` list in
[`.github/workflows/renovate.yml`](https://github.com/voc0der/reddont/blob/main/.github/workflows/renovate.yml).

| Workflow | Finds | Runs on |
| --- | --- | --- |
| codeql | JavaScript data-flow problems | Pull requests, pushes to `main`, weekly |
| Semgrep Security Analysis | Insecure patterns in the code, templates and Dockerfile | Pull requests, pushes to `main`, weekly |
| Dependency Audit | Known vulnerabilities in Bun packages; on a pull request, only in packages it adds or changes | Pull requests, pushes to `main`, three times a week |
| Gitleaks | Credentials in committed changes: a pull request's or a push's own commits, or the whole history | Pull requests, pushes to `main`, weekly |
| zizmor | Workflow problems such as injection, broad permissions, persisted credentials and unpinned actions | Pull requests and pushes that change `.github/`, weekly |
| Fuzz | Inputs that break a security property of the code that handles requests, Reddit's responses and pasted credentials | Pull requests that change code; three times a week after `main` changes |
| ZAP | Missing security headers, weak cookies and information leaks in the app as built | Pull requests that change the app or the image |
| Container Scan | Known vulnerabilities in the published `latest` and `nightly` images (Grype) | Three times a week |

Publishing also scans each platform's image with Grype before anything is
pushed. Scheduled runs catch advisories published since the code last changed.

## CodeQL

CodeQL uploads its results to code scanning, and the job then fails while any
CodeQL alert is open on the ref it analyzed (for a pull request, its merge
result). Fix a finding; for a reviewed false positive, dismiss the alert in
code scanning with the reason in its comment, which closes it everywhere.

## Semgrep

Semgrep runs the registry's recommended rules (`--config=auto`). Silence a
reviewed false positive with a `nosemgrep: <rule id>` comment on the line above
it, with the reason (`//- nosemgrep: ...` in Pug). The Pug href rule is
excluded in the workflow: it flags every `href` that isn't a quoted literal,
including site paths built in template literals, and the links that carry a URL
from Reddit's data go through `safeExternalUrl`, which keeps only http and https.
Test files are skipped in `.semgrepignore`, as Semgrep's own defaults skip test
directories. Locally:

```sh
image="$(sed -n 's/^ *image: //p' .github/workflows/semgrep.yml)"
docker run --rm -v "$PWD:/src" -w /src "$image" semgrep scan --config=auto --error \
  --exclude-rule javascript.express.security.audit.xss.pug.var-in-href.var-in-href
```

A local scan also reads files git doesn't track. Keep credentials out of the
checkout, or skip them with `--exclude <file>`.

## Dependency Audit

On a pull request, GitHub's dependency review compares the pull request's
dependencies with its base branch and fails on a high or critical advisory
against any package version the pull request brings in. An advisory against a
package `main` already has is not the pull request's doing, so it fails the
runs on `main` instead: on every push and three times a week, `bun audit` fails
on high or critical advisories for any package in `bun.lock`, development
packages included, since they run during builds and tests. Update the
dependency; Renovate opens security updates without the usual three-day wait.

```sh
bun audit --audit-level=high
```

## Gitleaks

A pull request's run scans its own commits, and a push to `main` the commits it
added, which takes seconds. The weekly run, a manual run, and any change to the
Gitleaks image, `.gitleaks.toml` or `.gitleaksignore` scan the whole history
instead: only a new rule or a narrower exception can turn up something in a
commit already scanned. Findings are redacted in the log. Locally it reads only
committed changes:

```sh
image="$(sed -n 's/^ *GITLEAKS_IMAGE: //p' .github/workflows/gitleaks.yml)"
docker run --rm -v "$PWD:/repo:ro" "$image" git /repo --log-opts=origin/main..HEAD --redact --verbose   # this branch
docker run --rm -v "$PWD:/repo:ro" "$image" git /repo --log-opts=HEAD --redact --verbose                # everything
```

A reviewed placeholder goes in `.gitleaks.toml`, matched by both file and exact
value. Revoke a real credential first, then remove it from the pull request's
commits. If it has already reached `main`, add the finding's `Fingerprint` to a
`.gitleaksignore` instead, with the reason above it.

## zizmor

zizmor runs the release that zizmor-action pins. Every action is pinned to a
commit, with the version in a comment that Renovate reads and updates. Silence a
reviewed finding with `# zizmor: ignore[<audit>]` on the flagged line and the
reason above it. Use `.github/zizmor.yml` only where that line can't take the
comment, such as a `uses:` line that ends in the version comment. Its online
audits, which also check the pinned actions for known vulnerabilities, need a
GitHub token; without one, zizmor runs offline.

```sh
GH_TOKEN="$(gh auth token)" uvx zizmor .
```

## Container Scan

Container Scan and the publish workflow's scans fail on high or critical
vulnerabilities that have a fix. A failing scheduled scan means a published
image needs rebuilding: [publish a nightly](releases.md#publish-a-nightly) for
`nightly`, and a release for `latest`. A finding while publishing stops it
before anything is pushed; fix it on `main` and publish again. Record a reviewed
false positive as an `ignore` rule in a `.grype.yaml` at the repository root. To
scan a local build the same way with [Grype](https://github.com/anchore/grype):

```sh
docker buildx build --pull --load -t reddont:local .
grype docker:reddont:local --fail-on high --only-fixed
```

Without `--pull`, an outdated cached base image can report vulnerabilities that
CI's build doesn't have. The image installs only runtime packages (no
development or peer dependencies), takes Debian's security updates when it is
built, and drops privileges with util-linux's `setpriv`, so no Go binary ships
in it.

## ZAP

ZAP runs its passive baseline scan against a disposable container of the image
built from the pull request, started with the image's default settings, so it
sees what a visitor to a fresh install sees. ZAP and its rules are pinned
(`-silent` stops add-on updates), so a result changes only with the app or the
pin. Any warning fails; `dev/zap/rules.tsv` lists reviewed rules, where `IGNORE`
silences a rule and `INFO` reports it without failing, each with its reason.
reddont sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
`Referrer-Policy: same-origin` on every response, and no `X-Powered-By`. The
missing Content Security Policy is `INFO`: every page runs inline scripts and
shows media from Reddit's and other hosts, so a policy needs testing page by
page. The scan needs Docker and pulls the ZAP image, several GB unpacked:

```sh
bun run scan:zap                      # builds reddont:local, then scans it
bash dev/zap/scan.sh <image>          # scans an image you already have
```

## Fuzz tests

The `src/fuzz/*.test.js` files hold [fast-check](https://fast-check.dev)
properties: each asserts a security property over inputs it generates. They run
with the regular tests on a fixed set of inputs, so a pull request never fails
on an input an earlier run happened not to draw, and under `dev/fuzz/run.sh` for
a set time each, from a fresh seed.

| Property | Holds that |
| --- | --- |
| Redirect targets | A path from `?redirect=` or a failed page's address sends a browser only to this site, however it's written |
| API source whitelist | An address reaches the API only when a well-formed entry lists it, however the socket writes it; a malformed entry lists nothing |
| Reddit requests | Whatever a request's sort, community, IDs and search terms hold, reddont asks only Reddit's hosts, and only the endpoints it means to call |
| Old reddit's pages | A page names posts, communities and next pages only by their fullnames |
| Reddit credentials | A pasted credential becomes a well-formed Cookie or Authorization header with no line break, or is refused |
| App IDs | An accepted app ID makes a single Basic credential, with no secret |

Pull requests that change code run each property for 10 seconds; the scheduled
run gives each 2 minutes, on days after `main` has changed. A failure prints the
smallest input fast-check could shrink it to, with the `FUZZ_SEED` and
`FUZZ_PATH` that replay it, and CI keeps the report as the run's
`fuzz-failures` artifact. Add the input to the property's examples with the fix:
from then on it runs with the regular tests. A new file in `src/fuzz/` needs no
registration.

```sh
bun run fuzz                          # each property for 10s
FUZZTIME=2m bun run fuzz              # as long as the scheduled run
FUZZ_SEED=<seed> FUZZ_PATH=<path> bun test src/fuzz/redirects.test.js
```

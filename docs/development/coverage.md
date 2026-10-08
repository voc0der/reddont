# Test coverage

[![JavaScript line coverage](https://img.shields.io/badge/line_coverage-87.62%25-brightgreen)](../assets/coverage-summary.json)

The README badge reports **JavaScript line coverage** from the Bun test suite.
It is a checked-in measurement; it changes when a contributor recalculates it.
The [published summary](../assets/coverage-summary.json) records the covered and
eligible line counts for every source file, test results, Bun version, and a
hash of the measured source files.

## Calculate coverage

From the repository root, with Bun 1.4.2 and npm installed:

```sh
bun install --frozen-lockfile
npm ci --prefix dev/test-coverage
bun run coverage
```

Allow localhost listeners: the integration tests start isolated test servers.
Tests use temporary databases and simulated upstream responses; no running
instance or upstream credentials are needed.

The runner copies `src/` into a temporary directory, instruments application
JavaScript with Istanbul, and runs the existing tests on that copy. It merges
counters from the test process and every server process the tests start. Every
eligible file starts with zero hits, so files that tests never load remain in
the total.
The source checkout is not instrumented, and the temporary copy is removed
after the run.

Reports are written to the ignored `coverage/unit/` directory:

| File | Contents |
| --- | --- |
| `summary.json` | Weighted line totals, per-file counts, test totals, and source hash. |
| `lcov.info` | Per-line coverage for editors and other tools. |
| `coverage-final.json` | Merged Istanbul counters. |
| `coverage-summary.json` | Istanbul's line, statement, function, and branch summaries. |
| `tests.xml` | JUnit test results, including skipped and failed tests. |
| `raw/` | Separate process snapshots used by the merge. |

## Metric and scope

```text
line coverage (%) = 100 × total covered lines / total eligible lines
```

An eligible line is a line containing an executable statement identified by
Istanbul. It is covered when a statement on that line runs. A line reached in
several processes counts once. Sum the line counts across files before dividing;
do not average file percentages or combine percentages from different tools.

The inventory includes every `.js`, `.cjs`, and `.mjs` application file under
`src/`, including untested files. These exclusions define the badge's scope:

| Exclusion | Reason |
| --- | --- |
| `*.test.*`, `*.spec.*`, and `src/test-support/` | Tests and fixtures are not application code. |
| Pug templates and their embedded JavaScript | Templates generate code dynamically; that generated code is outside this JavaScript-file metric. Rendering tests still run. |
| CSS, images, manifests, and other non-JavaScript assets | Not executable JavaScript. |
| Dependencies, build output, and `dev/` tooling | Third-party, generated, or development-only code. |

Standalone browser scripts in `src/public/` **are included**, even when they
have zero hits. Unit tests run the service worker with stand-ins for its browser
globals. The separate Playwright harness is not part of this calculation, so its
browser activity does not contribute to the badge; `comments.js`, which only
that harness exercises, counts as uncovered.

[Bun's built-in coverage](https://bun.com/docs/test/code-coverage) only tracks
loaded files. Its default report also misses the fixture servers' separate
processes. Use `bun run coverage` for the badge instead of copying the percentage
from `bun test --coverage`.

## Refresh the badge

```sh
bun run coverage --update-badge
```

This reruns the calculation and updates the Shields.io badge URLs in `readme.md`
and this guide, plus `docs/assets/coverage-summary.json`. Commit those changes
with the source or test change that affects coverage. The command refuses to
publish a new measurement
if tests fail or are skipped, no tests run, a process report is missing, or
fixture-server coverage is absent. It does not modify the badge on a failed run.

Keep the same scope when comparing results. The published source hash changes
when an included file is added, removed, or edited; the per-file counts make
missing files and zero-coverage areas visible.

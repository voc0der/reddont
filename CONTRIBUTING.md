# Contributing

For setup and local run instructions, see the [development guide](docs/development/index.md).

## Rules

- Keep branches, commits, and PRs focused. Do not mix unrelated local changes into the same PR.
- Use semantic names by default.
- Follow the existing code style and keep formatting changes limited to the code you touch.
- Update the relevant documentation when behavior or configuration changes.

## Naming

- Branches: `fix/<scope>-<summary>`, `feat/<scope>-<summary>`, `refactor/<scope>-<summary>`
- Commits: `fix(scope): summary`, `feat(scope): summary`, `refactor(scope): summary`
- PR titles: `fix(scope): summary`, `feat(scope): summary`, `refactor(scope): summary`

Use `docs` for documentation changes and `test` for changes limited to tests.

## Before opening a PR

- Run `bun test` for application changes. Add or update tests for changed behavior where they help catch regressions.
- Check interface changes in a browser at desktop and mobile widths, including light and dark themes.
- For documentation changes, follow the [documentation setup](docs/development/documentation.md), run `zensical build --clean --strict`, and preview the edited pages.
- For container changes, validate `docker compose config` and build the Dockerfile. See the [development guide](docs/development/index.md) for packaging checks.
- Review the final diff for unrelated edits, generated output, and credentials.
- Describe the problem, the resulting behavior, and how you verified the change. Note any checks you could not run.

## Tests

Keep tests isolated from real application data. Use temporary directories and databases for tests that write files or start the application, and clean up after them. A test run should leave tracked files and fixtures unchanged.

Prefer tests that exercise observable behavior. For a bug fix, cover the failing case when practical.

## Coverage

Follow the [coverage guide](docs/development/coverage.md) to calculate coverage
and refresh the README badge and its published summary.

- When reporting a percentage, name the metric. Use line coverage for a README coverage badge.
- Include untested application files in the total. Check for source files missing from the report; missing files can inflate the result.
- Exclude tests, test helpers, and generated code. Document other exclusions and why they are needed.
- Combine coverage using total covered lines divided by total eligible lines, rather than averaging percentages from separate reports.
- Check for skipped tests or missing test services before publishing a result.
- Refresh any published coverage figure in the same PR as changes that affect it, using a fresh run with the same measurement scope.

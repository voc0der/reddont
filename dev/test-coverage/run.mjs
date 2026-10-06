import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInstrumenter } from "istanbul-lib-instrument";
import { createCoverageMap } from "istanbul-lib-coverage";
import { createContext } from "istanbul-lib-report";
import reports from "istanbul-reports";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const reportDir = join(root, "coverage/unit");
const updateBadge = process.argv.includes("--update-badge");
if (process.argv.slice(2).some((arg) => arg !== "--update-badge")) {
	throw new Error("Usage: bun run coverage [--update-badge]");
}

async function sourceFiles(dir) {
	const files = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === "test-support") continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...await sourceFiles(path));
		else if (/\.[cm]?js$/.test(entry.name) && !/\.(test|spec)\.[cm]?js$/.test(entry.name)) files.push(path);
	}
	return files.sort();
}

function badgeUrl(percent) {
	const color = percent >= 80 ? "brightgreen" : percent >= 60 ? "yellow" : "red";
	return `https://img.shields.io/badge/line_coverage-${percent.toFixed(2)}%25-${color}`;
}

const workDir = await mkdtemp(join(tmpdir(), "reddont-coverage-"));
try {
	// Work on disposable copies: never instrument the checkout or real app data.
	await rm(reportDir, { recursive: true, force: true });
	await mkdir(join(reportDir, "raw"), { recursive: true });
	await cp(join(root, "src"), join(workDir, "src"), { recursive: true });
	await cp(join(root, "package.json"), join(workDir, "package.json"));
	await symlink(join(root, "node_modules"), join(workDir, "node_modules"), "dir");

	// This collector runs in both the test runner and the fixture server. The
	// server's test harness stops it with SIGTERM, so flush counters on that exit.
	const collector = join(workDir, "collect.cjs");
	await writeFile(collector, `const fs = require("node:fs");
function flush() {
  fs.writeFileSync(${JSON.stringify(join(reportDir, "raw"))} + "/" + process.pid + ".json", JSON.stringify(globalThis.__coverage__ || {}));
}
module.exports = { flush };
process.once("exit", flush);
process.once("SIGTERM", () => process.exit(0));
`);
	// Bun's test runner can finish without emitting the normal process exit
	// event. A test lifecycle hook flushes its counters before the runner exits.
	const preload = join(workDir, "coverage-preload.cjs");
	await writeFile(preload, `const { afterAll } = require("bun:test");
const { flush } = require("./collect.cjs");
afterAll(flush);
`);
	const files = await sourceFiles(join(root, "src"));
	const map = createCoverageMap({});
	const sourceHash = createHash("sha256");
	for (const file of files) {
		const name = relative(root, file).replaceAll("\\", "/");
		const source = await readFile(file, "utf8");
		sourceHash.update(name).update("\0").update(source).update("\0");
		const instrumenter = createInstrumenter({ compact: false, preserveComments: true });
		const code = instrumenter.instrumentSync(source, name);
		// Seed *every* source file at zero, including ones no test ever loads.
		map.addFileCoverage(instrumenter.lastFileCoverage());
		const collect = name.startsWith("src/public/") ? "" : `require(${JSON.stringify(collector)});\n`;
		await writeFile(join(workDir, name), collect + code);
	}

	const result = Bun.spawn([
		process.execPath, "test", "--no-env-file", "--only-failures", "--preload", preload, "--reporter=junit",
		`--reporter-outfile=${join(reportDir, "tests.xml")}`,
	], {
		cwd: workDir,
		// Do not inherit production credentials, services, or the data directory.
		env: { PATH: process.env.PATH, TZ: "UTC", REDDONT_DATA_DIR: join(workDir, "data") },
		stdout: "inherit", stderr: "inherit",
	});
	assert.equal(await result.exited, 0, "Tests failed; coverage badge was not updated");
	const junit = await readFile(join(reportDir, "tests.xml"), "utf8");
	assert(!/\b(?:skipped|failures|errors)="[1-9]\d*"/.test(junit), "Tests were skipped or failed; do not publish partial coverage");
	const testCount = Number(junit.match(/<testsuites\b[^>]*\btests="(\d+)"/)?.[1]);
	assert(testCount > 0, "No completed tests were reported");

	const snapshots = (await readdir(join(reportDir, "raw"))).filter((name) => name.endsWith(".json"));
	assert(snapshots.length >= 2, "Missing coverage from the test runner or fixture server");
	for (const snapshot of snapshots) {
		const data = JSON.parse(await readFile(join(reportDir, "raw", snapshot), "utf8"));
		for (const name of Object.keys(data)) assert(map.files().includes(name), `Unexpected source file: ${name}`);
		map.merge(data);
	}
	assert.equal(map.files().length, files.length, "Coverage source inventory is incomplete");
	assert(map.fileCoverageFor("src/routes/index.js").toSummary().lines.covered > 0, "Fixture-server coverage was not collected");

	const context = createContext({ dir: reportDir, coverageMap: map });
	for (const format of ["text", "json", "json-summary", "lcovonly"]) reports.create(format).execute(context);
	const byFile = Object.fromEntries(map.files().sort().map((name) => {
		const { covered, total } = map.fileCoverageFor(name).toSummary().lines;
		return [name, { covered, total }];
	}));
	const covered = Object.values(byFile).reduce((sum, file) => sum + file.covered, 0);
	const total = Object.values(byFile).reduce((sum, file) => sum + file.total, 0);
	const percent = Number((100 * covered / total).toFixed(2));
	const summary = {
		metric: "JavaScript line coverage",
		covered, total, percent,
		bunVersion: Bun.version,
		tests: { passed: testCount, skipped: 0, failed: 0 },
		processes: snapshots.length,
		sourceSha256: sourceHash.digest("hex"),
		files: byFile,
	};
	await writeFile(join(reportDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
	console.log(`\nJavaScript line coverage: ${covered} / ${total} × 100 = ${percent.toFixed(2)}% (${files.length} files, ${snapshots.length} processes)`);
	console.log(`Reports: ${relative(root, reportDir)}/`);
	if (updateBadge) {
		for (const name of ["readme.md", "docs/development/coverage.md"]) {
			const path = join(root, name);
			const markdown = await readFile(path, "utf8");
			const pattern = /(!\[JavaScript line coverage\]\()[^)]+(\))/;
			assert(pattern.test(markdown), `Coverage badge not found in ${name}`);
			await writeFile(path, markdown.replace(pattern, `$1${badgeUrl(percent)}$2`));
		}
		await writeFile(join(root, "docs/assets/coverage-summary.json"), JSON.stringify(summary, null, 2) + "\n");
		console.log("Updated the README badge and published coverage summary.");
	}
} finally {
	await rm(workDir, { recursive: true, force: true });
}

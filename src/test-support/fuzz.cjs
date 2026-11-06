// Runs the fuzz tests' fast-check properties (src/fuzz/).
//
// With the regular tests, each property checks its recorded examples and then a
// fixed set of generated inputs: the seed never changes, so a pull request can't
// fail on an input that an earlier run happened not to draw. Under
// dev/fuzz/run.sh, FUZZTIME (a duration such as 10s or 2m) runs each property for
// that long instead, from a fresh seed.
//
// A failure reports the smallest input fast-check could shrink it to, with the
// seed and path that replay it: FUZZ_SEED=<seed> FUZZ_PATH=<path>. Add the input
// to the property's examples with the fix, and it runs with the regular tests
// from then on. When FUZZ_FAILURES names a directory, each report is also
// written there, for CI to keep.
const fc = require("fast-check");
const fs = require("node:fs");
const path = require("node:path");

const REGULAR_SEED = 20261105;
const REGULAR_RUNS = 200;

function parseDuration(text) {
	const match = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(String(text).trim());
	if (!match || !match.slice(1).some(Boolean)) {
		throw new Error(`FUZZTIME must be a duration such as 30s or 2m, not ${JSON.stringify(text)}`);
	}
	const [, hours, minutes, seconds, milliseconds] = match.map((part) => Number(part || 0));
	return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

const fuzzTime = process.env.FUZZTIME ? parseDuration(process.env.FUZZTIME) : null;
const fuzzing = fuzzTime !== null;

// A test's time limit, for bun:test's third argument: generous for the regular
// runs, and the fuzz time with room to spare while fuzzing.
const timeout = fuzzing ? fuzzTime + 60000 : 60000;

function parameters(examples) {
	const params = { examples };
	if (fuzzing) {
		params.numRuns = Number.MAX_SAFE_INTEGER;
		params.interruptAfterTimeLimit = fuzzTime;
		params.markInterruptAsFailure = false;
	} else {
		params.numRuns = REGULAR_RUNS;
		params.seed = REGULAR_SEED;
	}
	if (process.env.FUZZ_SEED) {
		params.seed = Number(process.env.FUZZ_SEED);
		if (process.env.FUZZ_PATH) params.path = process.env.FUZZ_PATH;
	}
	return params;
}

function record(name, error) {
	const directory = process.env.FUZZ_FAILURES;
	if (!directory) return;
	fs.mkdirSync(directory, { recursive: true });
	const file = name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);
	fs.writeFileSync(path.join(directory, `${file}.txt`), `${name}\n\n${error.message}\n`);
}

// Checks a property inside a test, fc.property and fc.asyncProperty alike:
//
//   test("...", () => check("what it checks", fc.property(...), [examples]), timeout);
async function check(name, property, examples = []) {
	try {
		await fc.assert(property, parameters(examples));
	} catch (error) {
		record(name, error);
		throw error;
	}
}

module.exports = { check, fuzzing, timeout };

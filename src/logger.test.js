const { afterEach, beforeEach, describe, expect, spyOn, test } = require("bun:test");
const logger = require("./logger");

let output;

beforeEach(() => {
	// Error is the highest level, so these lines print whatever LOG_LEVEL is.
	output = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	output.mockRestore();
});

function logged() {
	expect(output).toHaveBeenCalledTimes(1);
	return output.mock.calls[0][0];
}

describe("logger", () => {
	test("escapes line breaks and tabs so a value cannot forge log lines", () => {
		logger.error("Rejected", "reader\r\n[INFO] Login succeeded\tadmin");

		expect(logged()).toBe("[ERROR] Rejected reader\\r\\n[INFO] Login succeeded\\tadmin");
	});

	test("prints errors with their name, message, and stack on one line", () => {
		const error = new TypeError("bad input");
		logger.error("Request failed", error);

		const line = logged();
		expect(line).toStartWith('[ERROR] Request failed {"name":"TypeError","message":"bad input","stack":"TypeError: bad input');
		expect(line).not.toContain("\n");
	});

	test("serializes primitives and objects", () => {
		logger.error(undefined, null, 3, false, 10n, { id: 1, path: "/r/test\n" });

		expect(logged()).toBe('[ERROR] undefined null 3 false 10 {"id":1,"path":"/r/test\\n"}');
	});

	test("replaces values JSON cannot represent", () => {
		const circular = { name: "loop" };
		circular.self = circular;
		logger.error("State", circular, { total: 1n });

		expect(logged()).toBe("[ERROR] State [unserializable] [unserializable]");
	});
});

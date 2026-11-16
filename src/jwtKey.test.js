const { describe, expect, test } = require("bun:test");
const { resolveJwtKey } = require("./jwtKey");

describe("the session key", () => {
	test("is JWT_SECRET_KEY, as given, when set", () => {
		expect(resolveJwtKey({ JWT_SECRET_KEY: " a long configured secret " })).toEqual({
			key: " a long configured secret ",
			generated: false,
		});
	});

	test("is 256 random bits, new each start, when JWT_SECRET_KEY is unset or blank", () => {
		const keys = [{}, { JWT_SECRET_KEY: "" }, { JWT_SECRET_KEY: "  \n" }].map((env) => {
			const { key, generated } = resolveJwtKey(env);
			expect(generated).toBe(true);
			expect(key).toMatch(/^[0-9a-f]{64}$/);
			return key;
		});
		expect(new Set(keys).size).toBe(keys.length);
	});
});

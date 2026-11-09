const { afterAll, beforeAll, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { startServer } = require("../test-support/server.cjs");

const secret = "isolated-media-proxy-test-secret";
const session = `auth_token=${jwt.sign({ id: 1, username: "browser" }, secret, { expiresIn: "1h" })}`;

for (const mode of ["stream", "disk"]) {
	describe(`MEDIA_PROXY=${mode}`, () => {
		let server;

		beforeAll(async () => {
			// A browser rate limit of 3 page requests per window: one page of
			// thumbnails would use it up if the proxy counted against it.
			server = await startServer("browsing-server.cjs", "browsing-test", {
				JWT_SECRET_KEY: secret,
				MEDIA_PROXY: mode,
				RATE_LIMIT: "3",
			});
		}, 15000);

		afterAll(async () => {
			await server?.stop();
		});

		function get(route, cookie = session) {
			return fetch(server.baseUrl + route, { headers: { Cookie: cookie }, redirect: "manual" });
		}

		test("pages load Reddit's media through reddont", async () => {
			const page = await (await get("/media/https://i.redd.it/photo.JPG")).text();

			expect(page).toContain('<img class="media-maximized" src="/proxy/i.redd.it/photo.JPG"');
		});

		test("signed-in readers get the file, past the rate limit and without cookies", async () => {
			for (let i = 0; i < 5; i++) {
				const response = await get("/proxy/i.redd.it/photo.JPG");
				expect(response.status).toBe(200);
				expect(response.headers.get("content-type")).toBe("image/jpeg");
				expect(response.headers.get("cache-control")).toBe("public, max-age=604800");
				expect(response.headers.getSetCookie()).toEqual([]);
				expect(await response.text()).toBe("jpeg bytes");
			}

			const fetched = server.requests().filter((request) => request.path === "/photo.JPG");
			expect(fetched).toHaveLength(mode === "disk" ? 1 : 5);
			const cacheDir = path.join(server.dataDir, "media-cache");
			expect(fs.existsSync(cacheDir)).toBe(mode === "disk");
		});

		test("readers who aren't signed in are sent to log in", async () => {
			const response = await get("/proxy/i.redd.it/photo.JPG", "");

			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toStartWith("/login");
		});
	});
}

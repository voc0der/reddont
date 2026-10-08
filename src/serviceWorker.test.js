const { describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");

const ORIGIN = "https://reddont.test";
// express.static serves src/public at the site root.
const source = fs.readFileSync(path.join(__dirname, "public", "service-worker.js"), "utf8");

function cacheKey(request) {
	return new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
}

class FakeCache {
	entries = new Map();

	async match(request) {
		return this.entries.get(cacheKey(request))?.clone();
	}

	async put(request, response) {
		this.entries.set(cacheKey(request), response);
	}

	async addAll(urls) {
		for (const url of urls) this.entries.set(cacheKey(url), new Response(`cached ${url}`));
	}
}

function fakeCacheStorage() {
	const stores = new Map();
	return {
		stores,
		async open(name) {
			if (!stores.has(name)) stores.set(name, new FakeCache());
			return stores.get(name);
		},
		async keys() {
			return [...stores.keys()];
		},
		async delete(name) {
			return stores.delete(name);
		},
		async match(request) {
			for (const cache of stores.values()) {
				const response = await cache.match(request);
				if (response) return response;
			}
		},
	};
}

function request(url, { method = "GET", destination = "", headers = {} } = {}) {
	return { url: new URL(url, ORIGIN).href, method, destination, headers: new Headers(headers) };
}

// Runs the worker script with stand-ins for the service worker globals it uses.
function startWorker({ network = (req) => new Response(`network ${req.url}`), clients = {} } = {}) {
	const listeners = {};
	const calls = { fetched: [], skipWaiting: 0, claim: 0 };
	const caches = fakeCacheStorage();
	const self = {
		location: new URL("/service-worker.js", ORIGIN),
		addEventListener: (type, listener) => {
			listeners[type] = listener;
		},
		skipWaiting: () => {
			calls.skipWaiting++;
		},
		clients: {
			claim: async () => {
				calls.claim++;
			},
			get: async (id) => clients[id],
		},
	};
	const fetch = async (req) => {
		calls.fetched.push(req.url);
		return network(req);
	};
	const quiet = { log() {}, error() {} };
	new Function("self", "caches", "fetch", "console", source)(self, caches, fetch, quiet);

	async function lifecycle(type, init = {}) {
		let pending;
		listeners[type]({ ...init, waitUntil: (promise) => { pending = promise; } });
		await pending;
	}

	return {
		calls,
		caches,
		install: () => lifecycle("install"),
		activate: () => lifecycle("activate"),
		message: (data, init = {}) => lifecycle("message", { data, ...init }),
		// Resolves to the worker's response, or undefined when it lets the browser handle the request.
		fetch(url, init) {
			let response;
			listeners.fetch({ request: request(url, init), respondWith: (promise) => { response = promise; } });
			return response;
		},
	};
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

describe("service worker lifecycle", () => {
	test("install caches the app shell and activates without waiting", async () => {
		const worker = startWorker();
		await worker.install();

		const [name, shell] = [...worker.caches.stores][0];
		expect(name).toMatch(/^reddont-v.+-static$/);
		expect([...shell.entries.keys()].map((url) => new URL(url).pathname)).toEqual([
			"/",
			"/styles.css",
			"/mobile.css",
			"/desktop.css",
			"/offline",
			"/favicon.svg",
			"/icons/icon-192.png",
			"/icons/icon-512.png",
		]);
		expect(worker.calls.skipWaiting).toBe(1);
	});

	test("activate removes earlier reddont caches and keeps current and unrelated ones", async () => {
		const worker = startWorker();
		await worker.install();
		await worker.fetch("/r/test");
		const current = [...worker.caches.stores.keys()];
		expect(current).toHaveLength(2);
		for (const name of ["reddont-v0.0.1-static", "reddont-v0.0.1-dynamic", "another-app"]) {
			await worker.caches.open(name);
		}

		await worker.activate();

		expect([...worker.caches.stores.keys()].sort()).toEqual([...current, "another-app"].sort());
		expect(worker.calls.claim).toBe(1);
	});
});

describe("service worker requests", () => {
	test("leaves writes, other origins, media streams, and extensions to the browser", () => {
		const worker = startWorker();

		expect(worker.fetch("/subscribe", { method: "POST" })).toBeUndefined();
		expect(worker.fetch("https://i.redd.it/photo.jpg")).toBeUndefined();
		expect(worker.fetch("/media/clip.mp4", { destination: "video" })).toBeUndefined();
		expect(worker.fetch("/vendor/dash.all.min.js", { headers: { Range: "bytes=0-" } })).toBeUndefined();
		expect(worker.fetch("chrome-extension://abc/script.js")).toBeUndefined();
		expect(worker.calls.fetched).toEqual([]);
	});

	test("scripts and styles use the network first and fall back to a cached copy", async () => {
		let network = (req) => new Response(`network ${new URL(req.url).pathname}`);
		const worker = startWorker({ network: (req) => network(req) });

		expect(await (await worker.fetch("/styles.css")).text()).toBe("network /styles.css");
		network = () => new Response("missing", { status: 404 });
		expect((await worker.fetch("/comments.js")).status).toBe(404);

		network = offline;
		expect(await (await worker.fetch("/styles.css")).text()).toBe("network /styles.css");
		await expect(worker.fetch("/comments.js")).rejects.toThrow("Failed to fetch");
	});

	test("images and icons come from the cache once stored", async () => {
		let network = () => new Response("image");
		const worker = startWorker({ network: (req) => network(req) });

		await worker.fetch("/icons/icon-192.png");
		network = offline;
		expect(await (await worker.fetch("/icons/icon-192.png")).text()).toBe("image");
		expect(worker.calls.fetched).toHaveLength(1);
		await expect(worker.fetch("/assets/nsfw.svg")).rejects.toThrow("Failed to fetch");
	});

	test("API and subscription requests always use the network", async () => {
		let network = () => Response.json({ html: "" });
		const worker = startWorker({ network: (req) => network(req) });

		for (const url of ["/api/r/test/posts", "/unsubscribe-all"]) {
			expect((await worker.fetch(url)).status).toBe(200);
		}
		network = offline;
		await expect(worker.fetch("/api/r/test/posts")).rejects.toThrow("Failed to fetch");
		expect(worker.caches.stores.size).toBe(0);
	});

	test("pages fall back to a cached copy, then the cached offline page", async () => {
		let network = (req) => new Response(`page ${new URL(req.url).pathname}`);
		const worker = startWorker({ network: (req) => network(req) });
		await worker.install();
		await worker.fetch("/r/test");

		network = offline;
		expect(await (await worker.fetch("/r/test")).text()).toBe("page /r/test");
		expect(await (await worker.fetch("/r/other")).text()).toBe("cached /offline");
	});

	test("pages without any cached copy get a minimal offline response", async () => {
		const worker = startWorker({ network: offline });
		const response = await worker.fetch("/r/test");

		expect(response.status).toBe(503);
		expect(response.headers.get("content-type")).toBe("text/html");
		expect(await response.text()).toContain("You are currently offline");
	});
});

describe("service worker updates", () => {
	test("skip waiting only when a page on this origin asks", async () => {
		const worker = startWorker({
			clients: {
				page: { url: `${ORIGIN}/r/test` },
				embedded: { url: "https://elsewhere.example/" },
			},
		});

		await worker.message(null, { source: { id: "page" } });
		await worker.message({ type: "CLAIM" }, { source: { id: "page" } });
		await worker.message({ type: "SKIP_WAITING" }, { origin: "https://elsewhere.example", source: { id: "page" } });
		await worker.message({ type: "SKIP_WAITING" }, { source: null });
		await worker.message({ type: "SKIP_WAITING" }, { source: { id: "closed" } });
		await worker.message({ type: "SKIP_WAITING" }, { source: { id: "embedded" } });
		expect(worker.calls.skipWaiting).toBe(0);

		await worker.message({ type: "SKIP_WAITING" }, { origin: ORIGIN, source: { id: "page" } });
		expect(worker.calls.skipWaiting).toBe(1);
	});
});

const { afterAll, afterEach, beforeAll, describe, expect, test } = require("bun:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const {
	MEDIA_HOSTS,
	createMediaProxy,
	mediaContentType,
	mediaProxyConfig,
	proxiedMediaUrl,
	scheduleMediaCacheSweeps,
	sweepMediaCache,
	upstreamMediaUrl,
} = require("./mediaProxy");

const realFetch = globalThis.fetch;
const IMAGE = Buffer.from("0123456789abcdef");
let upstream = [];

// Requests to Reddit's https hosts get `reply`; the tests' own requests to the
// local app go out for real.
function respond(reply) {
	upstream = [];
	globalThis.fetch = async (input, init = {}) => {
		const url = String(input);
		if (!url.startsWith("https://")) return realFetch(input, init);
		const request = { url, method: init.method ?? "GET", headers: new Headers(init.headers) };
		upstream.push(request);
		return reply(request);
	};
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

async function startApp(options) {
	const app = express();
	app.use("/proxy", createMediaProxy(options));
	const server = await new Promise((resolve) => {
		const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
	});
	return {
		get: (route, init) => realFetch(`http://127.0.0.1:${server.address().port}${route}`, { redirect: "manual", ...init }),
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

function image(headers = {}, body = IMAGE, status = 200) {
	return new Response(body, {
		status,
		headers: { "content-type": "image/png", "content-length": String(body.length), ...headers },
	});
}

// A 16-byte image whose connection drops after `sent`, or before anything
// arrives when `sent` is empty.
function brokenImage(sent) {
	const body = new ReadableStream({
		start(controller) {
			if (sent) controller.enqueue(sent);
			setTimeout(() => controller.error(new Error("connection reset")), 20);
		},
	});
	return new Response(body, { headers: { "content-type": "image/png", "content-length": String(IMAGE.length) } });
}

async function waitFor(check) {
	for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
	return check();
}

describe("settings", () => {
	test("leave the proxy off unless MEDIA_PROXY names a mode", () => {
		expect(mediaProxyConfig({}, "/data")).toEqual({
			mode: null,
			cacheDir: path.resolve("/data/media-cache"),
			cacheHours: 24,
			warnings: [],
		});
		for (const value of ["off", "false", "0", " "]) {
			expect(mediaProxyConfig({ MEDIA_PROXY: value }, "/data")).toMatchObject({ mode: null, warnings: [] });
		}
		expect(mediaProxyConfig({ MEDIA_PROXY: "stream" }, "/data").mode).toBe("stream");
		expect(mediaProxyConfig({ MEDIA_PROXY: " Disk " }, "/data").mode).toBe("disk");
	});

	test("warn about values they can't use", () => {
		const config = mediaProxyConfig({ MEDIA_PROXY: "yes", MEDIA_CACHE_HOURS: "-1" }, "/data");

		expect(config.mode).toBeNull();
		expect(config.cacheHours).toBe(24);
		expect(config.warnings).toEqual([
			'MEDIA_PROXY must be stream or disk, not "yes"; media loads from Reddit directly.',
			"MEDIA_CACHE_HOURS must be a number of hours, or 0 to keep files; using 24.",
		]);
		expect(mediaProxyConfig({ MEDIA_CACHE_HOURS: "soon" }, "/data").warnings).toHaveLength(1);
	});

	test("take a cache folder and how long to keep files", () => {
		const config = mediaProxyConfig({ MEDIA_PROXY: "disk", MEDIA_CACHE_DIR: "cache", MEDIA_CACHE_HOURS: "0" }, "/data");

		expect(config.cacheDir).toBe(path.resolve("cache"));
		expect(config.cacheHours).toBe(0);
		expect(mediaProxyConfig({ MEDIA_CACHE_HOURS: "1.5" }, "/data").cacheHours).toBe(1.5);
	});
});

describe("proxied URLs", () => {
	test("point Reddit's media hosts at /proxy and keep the path and query", () => {
		expect(proxiedMediaUrl("https://i.redd.it/abc.png")).toBe("/proxy/i.redd.it/abc.png");
		expect(proxiedMediaUrl("https://preview.redd.it/abc.png?width=640&amp;s=sig")).toBe(
			"/proxy/preview.redd.it/abc.png?width=640&amp;s=sig",
		);
		expect(proxiedMediaUrl("https://V.REDD.IT/clip/DASHPlaylist.mpd?a=1")).toBe(
			"/proxy/v.redd.it/clip/DASHPlaylist.mpd?a=1",
		);
		expect(proxiedMediaUrl("http://b.thumbs.redditmedia.com/t.jpg")).toBe("/proxy/b.thumbs.redditmedia.com/t.jpg");
		expect(proxiedMediaUrl("https://www.redditstatic.com")).toBe("/proxy/www.redditstatic.com/");
	});

	test("leave every other URL alone", () => {
		for (const url of [
			"https://i.imgur.com/abc.png",
			"https://www.reddit.com/r/test",
			"https://i.redd.it.example.com/abc.png",
			"https://i.redd.it:8443/abc.png",
			"https://user@i.redd.it/abc.png",
			"https://i.redd.it/abc.png#top",
			"/proxy/i.redd.it/abc.png",
			"/nsfw.svg",
			"",
		]) {
			expect(proxiedMediaUrl(url)).toBe(url);
		}
		expect(proxiedMediaUrl(undefined)).toBeUndefined();
		expect(proxiedMediaUrl(null)).toBeNull();
	});

	test("lead back only to Reddit's media hosts", () => {
		// Pages and the route agree on the hosts.
		for (const host of MEDIA_HOSTS) {
			expect(upstreamMediaUrl(proxiedMediaUrl(`https://${host}/a/b.png?s=1`).slice("/proxy".length))).toBe(
				`https://${host}/a/b.png?s=1`,
			);
		}
		expect(upstreamMediaUrl("/i.redd.it/abc.png?width=640&s=sig")).toBe("https://i.redd.it/abc.png?width=640&s=sig");
		expect(upstreamMediaUrl("/I.Redd.It/abc.png")).toBe("https://i.redd.it/abc.png");
		for (const requestUrl of ["/example.com/abc.png", "/i.redd.it", "//example.com/abc.png", "/i.redd.it.example.com/x", "/"]) {
			expect(upstreamMediaUrl(requestUrl)).toBeNull();
		}
		for (const trick of ["//example.com/x", "/@example.com/x", "/\\example.com/x", "/../../example.com/x", "/%2F%2Fexample.com"]) {
			expect(new URL(upstreamMediaUrl(`/i.redd.it${trick}`)).host).toBe("i.redd.it");
		}
	});

	test("keep Reddit's percent-encoding and encode what a name can't hold", () => {
		expect(upstreamMediaUrl("/preview.redd.it/%E6%97%A5%E6%9C%AC-v0-abc.png?width=640&s=sig")).toBe(
			"https://preview.redd.it/%E6%97%A5%E6%9C%AC-v0-abc.png?width=640&s=sig",
		);
		expect(upstreamMediaUrl("/i.redd.it/a%3Fb%23c.png")).toBe("https://i.redd.it/a%3Fb%23c.png");
		expect(upstreamMediaUrl("/i.redd.it/@x.png")).toBe("https://i.redd.it/%40x.png");
		expect(upstreamMediaUrl("/i.redd.it/abc.png?")).toBe("https://i.redd.it/abc.png?");
		expect(upstreamMediaUrl("/i.redd.it/%E6%97.png")).toBeNull();
	});

	test("keep media types and send anything else as a download", () => {
		expect(mediaContentType("image/webp")).toBe("image/webp");
		expect(mediaContentType("Video/MP4; codecs=avc1")).toBe("video/mp4");
		expect(mediaContentType("application/dash+xml")).toBe("application/dash+xml");
		expect(mediaContentType("application/x-mpegurl")).toBe("application/x-mpegurl");
		for (const type of ["text/html", "application/javascript", "image/", "", null]) {
			expect(mediaContentType(type)).toBe("application/octet-stream");
		}
	});
});

describe("MEDIA_PROXY=stream", () => {
	let app;
	beforeAll(async () => {
		app = await startApp({ mode: "stream" });
	});
	afterAll(() => app.close());

	test("passes a file through with Reddit's caching headers and nothing of the reader's", async () => {
		respond(() =>
			image({ "cache-control": "public, max-age=604800", etag: '"abc"', "set-cookie": "tracker=1", server: "varnish" }),
		);

		const response = await app.get("/proxy/preview.redd.it/pic.png?width=640&s=sig", {
			headers: { Cookie: "auth_token=secret", "User-Agent": "reader-browser" },
		});

		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("content-length")).toBe(String(IMAGE.length));
		expect(response.headers.get("cache-control")).toBe("public, max-age=604800");
		expect(response.headers.get("etag")).toBe('"abc"');
		expect(response.headers.get("content-security-policy")).toContain("sandbox");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("server")).toBeNull();
		expect(upstream).toHaveLength(1);
		expect(upstream[0].url).toBe("https://preview.redd.it/pic.png?width=640&s=sig");
		expect(upstream[0].headers.get("cookie")).toBeNull();
		expect(upstream[0].headers.get("accept")).toBe("*/*");
		expect(upstream[0].headers.get("user-agent")).toContain("Mozilla/5.0");
	});

	test("forwards byte ranges so video can seek", async () => {
		respond(() =>
			image(
				{ "content-type": "video/mp4", "content-range": "bytes 0-3/16", "accept-ranges": "bytes" },
				IMAGE.subarray(0, 4),
				206,
			),
		);

		const response = await app.get("/proxy/v.redd.it/clip/DASH_240.mp4", { headers: { Range: "bytes=0-3", "If-Range": '"abc"' } });

		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 0-3/16");
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE.subarray(0, 4));
		expect(upstream[0].headers.get("range")).toBe("bytes=0-3");
		expect(upstream[0].headers.get("if-range")).toBe('"abc"');
	});

	test("passes on revalidation and empty files without waiting on a body", async () => {
		respond(() => new Response(null, { status: 304, headers: { etag: '"abc"', "cache-control": "public, max-age=60" } }));
		const unchanged = await app.get("/proxy/i.redd.it/pic.png", { headers: { "If-None-Match": '"abc"' } });
		expect(unchanged.status).toBe(304);
		expect(unchanged.headers.get("etag")).toBe('"abc"');
		expect(upstream[0].headers.get("if-none-match")).toBe('"abc"');

		respond(() => image({}, Buffer.alloc(0)));
		const empty = await app.get("/proxy/i.redd.it/empty.png");
		expect(empty.status).toBe(200);
		expect((await empty.arrayBuffer()).byteLength).toBe(0);
	});

	test("answers HEAD without a body", async () => {
		respond(() => image());

		const response = await app.get("/proxy/i.redd.it/pic.png", { method: "HEAD" });

		expect(response.status).toBe(200);
		expect(response.headers.get("content-length")).toBe(String(IMAGE.length));
		expect(upstream[0].method).toBe("HEAD");
	});

	test("sends a page Reddit returns as a download, not a page", async () => {
		respond(() => new Response("<script>alert(1)</script>", { headers: { "content-type": "text/html" } }));

		const response = await app.get("/proxy/i.redd.it/pic.png");

		expect(response.headers.get("content-type")).toBe("application/octet-stream");
	});

	test("passes on Reddit's errors without its error pages", async () => {
		respond(() => new Response("<html>gone</html>", { status: 404 }));
		const missing = await app.get("/proxy/i.redd.it/gone.png");
		expect(missing.status).toBe(404);
		expect(await missing.text()).toBe("");

		respond(() => new Response("busy", { status: 503 }));
		expect((await app.get("/proxy/i.redd.it/busy.png")).status).toBe(502);

		respond(() => {
			throw new Error("connect ECONNREFUSED");
		});
		expect((await app.get("/proxy/i.redd.it/down.png")).status).toBe(502);
	});

	test("follows Reddit's redirects only to its other media hosts", async () => {
		respond(() => new Response(null, { status: 302, headers: { location: "/other.png?s=1" } }));
		const sameHost = await app.get("/proxy/i.redd.it/moved.png");
		expect(sameHost.status).toBe(302);
		expect(sameHost.headers.get("location")).toBe("/proxy/i.redd.it/other.png?s=1");

		respond(() => new Response(null, { status: 301, headers: { location: "https://preview.redd.it/x.png" } }));
		expect((await app.get("/proxy/i.redd.it/moved.png")).headers.get("location")).toBe("/proxy/preview.redd.it/x.png");

		respond(() => new Response(null, { status: 302, headers: { location: "https://www.reddit.com/media?url=x" } }));
		expect((await app.get("/proxy/i.redd.it/moved.png")).status).toBe(502);
	});

	test("refuses other hosts and methods without asking Reddit", async () => {
		respond(() => image());

		for (const route of ["/proxy/example.com/x.png", "/proxy//example.com/x.png", "/proxy/i.redd.it"]) {
			expect((await app.get(route)).status).toBe(404);
		}
		const post = await app.get("/proxy/i.redd.it/x.png", { method: "POST" });
		expect(post.status).toBe(405);
		expect(post.headers.get("allow")).toBe("GET, HEAD");
		expect(upstream).toEqual([]);
	});

	test("cuts the reader off when Reddit's connection drops, and keeps serving", async () => {
		respond(() => brokenImage(IMAGE.subarray(0, 4)));
		const midway = await app.get("/proxy/i.redd.it/midway.png");
		expect(midway.status).toBe(200);
		await expect(midway.arrayBuffer()).rejects.toThrow();

		// Not an empty 200 that a browser would keep under Reddit's caching
		// headers.
		respond(() => brokenImage());
		const early = await app.get("/proxy/i.redd.it/early.png");
		expect(early.status).toBe(502);
		expect(early.headers.get("cache-control")).toBeNull();

		respond(() => image());
		expect((await app.get("/proxy/i.redd.it/fine.png")).status).toBe(200);
	});
});

describe("MEDIA_PROXY=disk", () => {
	let root;
	let cacheDir;
	let app;
	beforeAll(async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-media-cache-"));
		// The default folder sits under ~/.local outside Docker.
		cacheDir = path.join(root, ".local", "media-cache");
		app = await startApp({ mode: "disk", cacheDir });
	});
	afterAll(async () => {
		await app.close();
		fs.rmSync(root, { recursive: true, force: true });
	});

	function cached(url) {
		const key = crypto.createHash("sha256").update(url).digest("hex");
		return path.join(cacheDir, key.slice(0, 2), key);
	}

	test("downloads a file once and serves the saved copy", async () => {
		respond(() => image({ expires: "Thu, 31 Dec 2037 23:59:59 GMT", "content-type": "image/webp" }));

		for (let i = 0; i < 2; i++) {
			const response = await app.get("/proxy/preview.redd.it/pic.png?width=640&s=sig");
			expect(response.status).toBe(200);
			expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE);
			expect(response.headers.get("content-type")).toBe("image/webp");
			expect(response.headers.get("expires")).toBe("Thu, 31 Dec 2037 23:59:59 GMT");
			// No max-age=0 from express to override Reddit's Expires.
			expect(response.headers.get("cache-control")).toBeNull();
			expect(response.headers.get("content-security-policy")).toContain("sandbox");
		}
		expect(upstream).toHaveLength(1);
		const file = cached("https://preview.redd.it/pic.png?width=640&s=sig");
		expect(fs.readFileSync(file)).toEqual(IMAGE);
		expect(JSON.parse(fs.readFileSync(`${file}.json`, "utf8"))).toEqual({
			type: "image/webp",
			cacheControl: null,
			expires: "Thu, 31 Dec 2037 23:59:59 GMT",
		});
	});

	test("answers byte ranges and revalidation from the copy", async () => {
		respond(() => image({ "content-type": "video/mp4", "cache-control": "public, max-age=1209600" }));

		const range = await app.get("/proxy/v.redd.it/clip/DASH_240.mp4", { headers: { Range: "bytes=2-5" } });
		expect(range.status).toBe(206);
		expect(range.headers.get("content-range")).toBe(`bytes 2-5/${IMAGE.length}`);
		expect(range.headers.get("cache-control")).toBe("public, max-age=1209600");
		expect(Buffer.from(await range.arrayBuffer())).toEqual(IMAGE.subarray(2, 6));
		expect(upstream[0].headers.get("range")).toBeNull();

		const etag = range.headers.get("etag");
		const revalidated = await app.get("/proxy/v.redd.it/clip/DASH_240.mp4", { headers: { "If-None-Match": etag } });
		expect(revalidated.status).toBe(304);
		expect(upstream).toHaveLength(1);
	});

	test("shares one download between readers who ask at once", async () => {
		respond(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			return image();
		});

		const responses = await Promise.all([1, 2, 3].map(() => app.get("/proxy/i.redd.it/popular.png")));

		expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
		expect(upstream).toHaveLength(1);
	});

	test("keeps nothing of a download that breaks, and tries again next time", async () => {
		const file = cached("https://i.redd.it/flaky.png");
		const leftovers = () => fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith(path.basename(file)));
		respond(() => brokenImage(IMAGE.subarray(0, 4)));

		expect((await app.get("/proxy/i.redd.it/flaky.png")).status).toBe(502);
		expect(leftovers()).toEqual([]);

		respond(() => image());
		const retry = await app.get("/proxy/i.redd.it/flaky.png");
		expect(retry.status).toBe(200);
		expect(Buffer.from(await retry.arrayBuffer())).toEqual(IMAGE);
		expect(leftovers().sort()).toEqual([path.basename(file), `${path.basename(file)}.json`]);
	});

	test("keeps nothing when Reddit doesn't send the file", async () => {
		respond(() => new Response("gone", { status: 404 }));

		expect((await app.get("/proxy/i.redd.it/gone.png")).status).toBe(404);
		expect((await app.get("/proxy/i.redd.it/gone.png")).status).toBe(404);
		expect(upstream).toHaveLength(2);
		expect(fs.existsSync(cached("https://i.redd.it/gone.png"))).toBe(false);
	});
});

describe("cache sweeps", () => {
	test("delete only the proxy's own files once they're too old", async () => {
		const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-media-sweep-"));
		const now = Date.now();
		const hour = 60 * 60 * 1000;
		const files = {
			old: path.join(cacheDir, "ab", "a".repeat(64)),
			oldMeta: path.join(cacheDir, "ab", `${"a".repeat(64)}.json`),
			crashed: path.join(cacheDir, "ab", `${"c".repeat(64)}.${crypto.randomUUID()}.tmp`),
			fresh: path.join(cacheDir, "ab", "b".repeat(64)),
			unrelated: path.join(cacheDir, "ab", "notes.txt"),
			otherFolder: path.join(cacheDir, "backups", "d".repeat(64)),
		};
		try {
			for (const [name, file] of Object.entries(files)) {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, name);
				const time = new Date(name === "fresh" ? now : now - 3 * hour);
				fs.utimesSync(file, time, time);
			}

			expect(await sweepMediaCache(cacheDir, 2 * hour, now)).toBe(3);

			const left = Object.keys(files).filter((name) => fs.existsSync(files[name]));
			expect(left).toEqual(["fresh", "unrelated", "otherFolder"]);
			expect(await sweepMediaCache(path.join(cacheDir, "missing"), hour)).toBe(0);
		} finally {
			fs.rmSync(cacheDir, { recursive: true, force: true });
		}
	});
});

describe("scheduled sweeps", () => {
	test("start with a sweep and repeat it, unless files are kept", async () => {
		const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "reddont-media-schedule-"));
		const old = path.join(cacheDir, "ab", "e".repeat(64));
		fs.mkdirSync(path.dirname(old));
		fs.writeFileSync(old, "old");
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
		fs.utimesSync(old, twoHoursAgo, twoHoursAgo);
		let timer = null;
		try {
			expect(scheduleMediaCacheSweeps(cacheDir, 0)).toBeNull();
			expect(fs.existsSync(old)).toBe(true);

			timer = scheduleMediaCacheSweeps(cacheDir, 1);
			expect(timer).not.toBeNull();
			expect(await waitFor(() => !fs.existsSync(old))).toBe(true);
		} finally {
			clearInterval(timer);
			fs.rmSync(cacheDir, { recursive: true, force: true });
		}
	});
});

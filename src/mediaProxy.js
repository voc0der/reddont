// Serves Reddit's images and video from reddont's own origin when MEDIA_PROXY
// is set, so readers' browsers never contact Reddit's media hosts (#92). Pages
// then load /proxy/<host>/<path>, which keeps Reddit's path: the relative
// segment paths inside v.redd.it's DASH and HLS manifests resolve back through
// the proxy, so the manifests need no rewriting.
//
// MEDIA_PROXY=stream passes each response through as it arrives.
// MEDIA_PROXY=disk downloads each file once into MEDIA_CACHE_DIR and serves the
// copy, deleting copies older than MEDIA_CACHE_HOURS.
const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { BROWSER_USER_AGENT } = require("./geddit.js");
const logger = require("./logger");

const MEDIA_PROXY_PREFIX = "/proxy";

// The only hosts the proxy fetches from, so it can't be used to reach others.
const MEDIA_HOSTS = [
	"i.redd.it",
	"preview.redd.it",
	"external-preview.redd.it",
	"v.redd.it",
	"a.thumbs.redditmedia.com",
	"b.thumbs.redditmedia.com",
	"emoji.redditmedia.com",
	"styles.redditmedia.com",
	"www.redditstatic.com",
];

// Images, video, audio and video manifests keep the type Reddit sends.
// Anything else, such as an HTML error page, goes out as a download so it
// can't render as a page on reddont's origin.
const MANIFEST_TYPES = ["application/dash+xml", "application/x-mpegurl", "application/vnd.apple.mpegurl"];

// Range headers make video seeking work; Reddit's caching headers let
// browsers and a caching reverse proxy keep the files.
const FORWARDED_REQUEST_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"];
const FORWARDED_RESPONSE_HEADERS = ["content-range", "accept-ranges", "cache-control", "expires", "last-modified", "etag"];
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

// A proxied file opened on its own gets a sandbox, so even an SVG can't run
// script on reddont's origin.
const SANDBOX_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

// Only the wait for Reddit's response headers is limited; a long video keeps
// streaming after them.
const UPSTREAM_HEADERS_TIMEOUT_MS = 15000;
const DEFAULT_CACHE_HOURS = 24;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const CACHE_SHARD = /^[0-9a-f]{2}$/;
// A cached file, its metadata, or a download a crash left behind.
const CACHE_FILE = /^[0-9a-f]{64}(\.json|\.[0-9a-f-]{36}\.tmp)?$/;

// Reads MEDIA_PROXY, MEDIA_CACHE_DIR and MEDIA_CACHE_HOURS. A mode of null
// leaves media loading from Reddit directly.
function mediaProxyConfig(env, dataDir) {
	const value = String(env.MEDIA_PROXY ?? "")
		.trim()
		.toLowerCase();
	const config = {
		mode: null,
		cacheDir: path.resolve(env.MEDIA_CACHE_DIR || path.join(dataDir, "media-cache")),
		cacheHours: DEFAULT_CACHE_HOURS,
		warnings: [],
	};
	if (value === "stream" || value === "disk") {
		config.mode = value;
	} else if (value && !["off", "false", "0"].includes(value)) {
		config.warnings.push(
			`MEDIA_PROXY must be stream or disk, not ${JSON.stringify(env.MEDIA_PROXY)}; media loads from Reddit directly.`,
		);
	}
	const hours = String(env.MEDIA_CACHE_HOURS ?? "").trim();
	if (hours) {
		const parsed = Number(hours);
		if (Number.isFinite(parsed) && parsed >= 0) {
			config.cacheHours = parsed;
		} else {
			config.warnings.push(
				`MEDIA_CACHE_HOURS must be a number of hours, or 0 to keep files; using ${DEFAULT_CACHE_HOURS}.`,
			);
		}
	}
	return config;
}

// The /proxy path for a Reddit media URL. Any other URL, including a relative
// one, comes back unchanged.
function proxiedMediaUrl(url) {
	if (typeof url !== "string") return url;
	const match = /^https?:\/\/([^/?#]+)(\/[^#]*)?$/i.exec(url);
	const host = match?.[1].toLowerCase();
	if (!host || !MEDIA_HOSTS.includes(host)) return url;
	return `${MEDIA_PROXY_PREFIX}/${host}${match[2] || "/"}`;
}

// The Reddit URL a request below /proxy stands for, or null for a host that
// isn't in MEDIA_HOSTS. The host string comes from the list itself and a fixed
// "/" follows it, so nothing in the request can change which server is asked.
function upstreamMediaUrl(requestUrl) {
	const match = /^\/([^/?#]+)\/([^#]*)$/.exec(String(requestUrl ?? ""));
	const host = match && MEDIA_HOSTS.find((candidate) => candidate === match[1].toLowerCase());
	return host ? `https://${host}/${match[2]}` : null;
}

function mediaContentType(contentType) {
	const type = String(contentType ?? "")
		.split(";")[0]
		.trim()
		.toLowerCase();
	return /^(image|video|audio)\/[a-z0-9.+-]+$/.test(type) || MANIFEST_TYPES.includes(type)
		? type
		: "application/octet-stream";
}

async function fetchUpstream(url, { method = "GET", headers = {}, signal } = {}) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal?.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(abort, UPSTREAM_HEADERS_TIMEOUT_MS);
	try {
		return await globalThis.fetch(url, {
			method,
			// Without Accept: */*, i.redd.it redirects to Reddit's image page.
			// Identity encoding keeps Content-Length true to the bytes passed on.
			headers: { Accept: "*/*", "Accept-Encoding": "identity", "User-Agent": BROWSER_USER_AGENT, ...headers },
			redirect: "manual",
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

// What to answer when Reddit doesn't send the file. A redirect to another of
// its media hosts goes back through the proxy; any other redirect, and
// Reddit's own server errors, become 502. Other errors pass on without
// Reddit's error page.
function upstreamFailure(upstream, url) {
	if (REDIRECT_STATUSES.includes(upstream.status)) {
		let target = null;
		try {
			target = new URL(upstream.headers.get("location") ?? "", url).href;
		} catch {}
		const location = target && proxiedMediaUrl(target);
		return location && location !== target ? { status: upstream.status, location } : { status: 502 };
	}
	return { status: upstream.status >= 500 ? 502 : upstream.status };
}

function sendFailure(res, failure) {
	if (failure.location) return res.redirect(failure.status, failure.location);
	return res.status(failure.status).end();
}

function setMediaHeaders(res, type) {
	res.set("Content-Type", type);
	res.set("Content-Security-Policy", SANDBOX_POLICY);
}

async function streamMedia(req, res, url) {
	const controller = new AbortController();
	res.on("close", () => controller.abort());
	const headers = {};
	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = req.get(name);
		if (value) headers[name] = value;
	}
	const upstream = await fetchUpstream(url, { method: req.method, headers, signal: controller.signal });
	if (!(upstream.ok || upstream.status === 304)) {
		await upstream.body?.cancel();
		return sendFailure(res, upstreamFailure(upstream, url));
	}
	// Answer only once Reddit's first bytes arrive (or its empty body ends):
	// a connection that drops before then becomes a 502, not an empty 200
	// that a browser would keep under Reddit's caching headers.
	const body = req.method === "HEAD" || !upstream.body ? null : Readable.fromWeb(upstream.body);
	if (body) await once(body, "readable");

	res.status(upstream.status);
	setMediaHeaders(res, mediaContentType(upstream.headers.get("content-type")));
	for (const name of FORWARDED_RESPONSE_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) res.set(name, value);
	}
	const length = upstream.headers.get("content-length");
	if (length && !upstream.headers.get("content-encoding")) res.set("Content-Length", length);
	if (!body) {
		await upstream.body?.cancel();
		return res.end();
	}
	await pipeline(body, res);
}

function createDiskStore(cacheDir) {
	// Concurrent requests for one file share a single download.
	const downloads = new Map();

	function cachePaths(url) {
		const key = crypto.createHash("sha256").update(url).digest("hex");
		const shard = key.slice(0, 2);
		return {
			dir: path.join(cacheDir, shard),
			name: path.join(shard, key),
			data: path.join(cacheDir, shard, key),
			meta: path.join(cacheDir, shard, `${key}.json`),
		};
	}

	async function readMeta(file) {
		try {
			return JSON.parse(await fsp.readFile(file, "utf8"));
		} catch {
			return null;
		}
	}

	// The file goes in under a temporary name and its metadata after it, so a
	// file with metadata is always complete.
	async function save(url, file) {
		const upstream = await fetchUpstream(url);
		if (upstream.status !== 200) {
			await upstream.body?.cancel();
			return upstreamFailure(upstream, url);
		}
		const meta = {
			type: mediaContentType(upstream.headers.get("content-type")),
			cacheControl: upstream.headers.get("cache-control"),
			expires: upstream.headers.get("expires"),
		};
		await fsp.mkdir(file.dir, { recursive: true });
		const temp = `${file.data}.${crypto.randomUUID()}.tmp`;
		try {
			await pipeline(Readable.fromWeb(upstream.body), fs.createWriteStream(temp));
			await fsp.rename(temp, file.data);
			await fsp.writeFile(temp, JSON.stringify(meta));
			await fsp.rename(temp, file.meta);
		} catch (error) {
			await fsp.rm(temp, { force: true });
			throw error;
		}
		return { status: 200, meta };
	}

	function download(url, file) {
		let pending = downloads.get(file.data);
		if (!pending) {
			pending = save(url, file).finally(() => downloads.delete(file.data));
			downloads.set(file.data, pending);
		}
		return pending;
	}

	return async function serveFromDisk(req, res, url) {
		const file = cachePaths(url);
		let meta = await readMeta(file.meta);
		if (!meta) {
			const saved = await download(url, file);
			if (saved.status !== 200) return sendFailure(res, saved);
			meta = saved.meta;
		}
		setMediaHeaders(res, meta.type);
		if (meta.cacheControl) res.set("Cache-Control", meta.cacheControl);
		if (meta.expires) res.set("Expires", meta.expires);
		// send handles Range, HEAD and conditional requests. The root keeps a
		// dot directory in MEDIA_CACHE_DIR, like ~/.local, from counting as a
		// hidden file, and cacheControl: false keeps Reddit's caching headers.
		await new Promise((resolve) => {
			res.sendFile(file.name, { root: cacheDir, cacheControl: false }, (error) => {
				// A sweep can delete the file between the metadata read and here.
				if (error && !res.headersSent) res.status(404).end();
				resolve();
			});
		});
	};
}

// Express middleware for requests below MEDIA_PROXY_PREFIX.
function createMediaProxy({ mode, cacheDir }) {
	if (!mode) return null;
	const serve = mode === "disk" ? createDiskStore(cacheDir) : streamMedia;
	return async function mediaProxy(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.set("Allow", "GET, HEAD");
			return res.status(405).end();
		}
		const url = upstreamMediaUrl(req.url);
		if (!url) return res.status(404).end();
		try {
			await serve(req, res, url);
		} catch (error) {
			if (res.headersSent) {
				// Usually the reader left mid-file.
				logger.debug(`Media proxy stopped sending ${url}: ${error.message}`);
				res.destroy();
			} else {
				logger.warn(`Media proxy could not fetch ${url}: ${error.message}`);
				res.status(502).end();
			}
		}
	};
}

// Deletes cached files last written more than maxAgeMs ago, including
// downloads a crash left behind. Only names the disk store creates are
// touched, so a MEDIA_CACHE_DIR shared with other files loses none of them.
// Returns how many files it removed.
async function sweepMediaCache(cacheDir, maxAgeMs, now = Date.now()) {
	let removed = 0;
	const shards = await fsp.readdir(cacheDir, { withFileTypes: true }).catch(() => []);
	for (const shard of shards) {
		if (!shard.isDirectory() || !CACHE_SHARD.test(shard.name)) continue;
		const dir = path.join(cacheDir, shard.name);
		for (const name of await fsp.readdir(dir).catch(() => [])) {
			if (!CACHE_FILE.test(name)) continue;
			const file = path.join(dir, name);
			const stat = await fsp.stat(file).catch(() => null);
			if (stat?.isFile() && now - stat.mtimeMs > maxAgeMs) {
				await fsp.rm(file, { force: true });
				removed++;
			}
		}
	}
	return removed;
}

// Sweeps now and then hourly. Returns the timer, or null when files are kept.
function scheduleMediaCacheSweeps(cacheDir, cacheHours) {
	if (!(cacheHours > 0)) return null;
	const maxAgeMs = cacheHours * 60 * 60 * 1000;
	const sweep = () =>
		sweepMediaCache(cacheDir, maxAgeMs)
			.then((removed) => {
				if (removed) logger.debug(`Media cache sweep removed ${removed} files.`);
			})
			.catch((error) => logger.warn(`Media cache sweep failed: ${error.message}`));
	sweep();
	const timer = setInterval(sweep, Math.min(SWEEP_INTERVAL_MS, maxAgeMs));
	timer.unref?.();
	return timer;
}

module.exports = {
	MEDIA_HOSTS,
	MEDIA_PROXY_PREFIX,
	createMediaProxy,
	mediaContentType,
	mediaProxyConfig,
	proxiedMediaUrl,
	scheduleMediaCacheSweeps,
	sweepMediaCache,
	upstreamMediaUrl,
};

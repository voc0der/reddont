const logger = require("./logger");
const { forgetRedditOAuthToken, getRedditOAuthToken } = require("./redditOAuth");
const { MORE_COMMENTS_LIMIT, commentSort } = require("./utils/redditComments");
const { readListingPage } = require("./utils/redditPage");

// www.reddit.com started answering signed-in cookies with its network-security
// block page one endpoint at a time: /api/morechildren (2026-10-23), /r/all
// listings (2026-10-29) and search (2026-10-31). old.reddit.com serves every
// request reddont makes to the same cookie, with the same JSON (checked
// 2026-10-31), so all cookie requests go there. Anonymous requests to
// old.reddit.com redirect to its login page, so only cookie requests go there.
//
// On 2026-11-03 both hosts started blocking every sorted listing
// (/r/x/hot.json, /hot.json) and search.json for cookie sessions, whatever the
// client. Their HTML pages and /api/info.json still answer the cookie, so
// cookie feeds and searches read the page for its order and next-page cursor,
// then load those things from /api/info.json.
//
// On 2026-11-04 old.reddit.com started blocking /api/morechildren.json for
// cookie sessions. /api/morechildren.api, Reddit's other JSON extension,
// returns the same JSON and isn't blocked, so cookie load more uses it.
//
// On 2026-11-05 it blocked /api/info.json the same way. /api/info.api returns
// the same listing, so cookie feeds and searches load their things from it.
const COOKIE_HOST = "https://old.reddit.com";
// Bearer tokens, including those an OAuth app gets (src/redditOAuth.js), go
// to oauth.reddit.com, which serves the same JSON without the .json
// extension; www.reddit.com refuses them. On 2026-11-05 it answered every
// request reddont makes to an app's token.
const OAUTH_HOST = "https://oauth.reddit.com";
// /api/info takes up to 100 fullnames.
const INFO_BATCH_SIZE = 100;
const COMMUNITY_NAME = /^t5_[a-z0-9]+$/;
// old.reddit.com redirects a multi to its canonical spelling: each name in
// its community's case, missing communities dropped (seen 2026-11-03).
const MAX_PAGE_REDIRECTS = 2;
const CANONICAL_PAGES_KEPT = 100;

// "/r/a+b/hot/" and "/r/A+B/hot" are the same kind of page: "/hot".
function pageKind(url) {
	return url.pathname.replace(/^\/r\/[^/]+/, "").replace(/\/$/, "");
}

class Geddit {
	constructor() {
		this.host = "https://www.reddit.com";
		// Requested page path -> the canonical path old reddit redirected it
		// to, so a feed's later loads skip the redirect.
		this.canonicalPages = new Map();
		this.parameters = {
			limit: 25,
			include_over_18: true,
		};
		this.headers = {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
			Accept: "application/json",
		};
	}

	sanitizeSort(sort) {
		const allowedSorts = new Set([
			"best",
			"hot",
			"new",
			"top",
			"rising",
			"controversial",
		]);
		return allowedSorts.has(sort) ? sort : "hot";
	}

	sanitizeSubredditPath(subreddit) {
		if (!subreddit || typeof subreddit !== "string") return "";
		const cleaned = subreddit
			.split("+")
			.map((part) => part.trim().replace(/^r\//i, ""))
			.filter((part) => /^[A-Za-z0-9_]{1,21}$/.test(part));
		return cleaned.join("+");
	}

	encodeSubredditPath(subredditPath) {
		if (!subredditPath) return "";
		return subredditPath
			.split("+")
			.map((segment) => encodeURIComponent(segment))
			.join("+");
	}

	sanitizeThingId(id) {
		if (!id || typeof id !== "string") return "";
		const trimmed = id.trim();
		return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "";
	}

	buildRedditUrl(pathname, options = {}, host = this.host) {
		const url = new URL(pathname, host);
		url.search = new URLSearchParams(options).toString();
		return url;
	}

	isSafeHeaderValue(value) {
		return typeof value === "string" && !/[\0-\x1F\x7F]/.test(value);
	}

	getRequestHeaders(requestOptions = {}) {
		const headers = { ...this.headers };
		const authHeaders = requestOptions?.authHeaders || {};
		const authorization =
			authHeaders.authorization || authHeaders.Authorization;
		const cookie = authHeaders.cookie || authHeaders.Cookie;

		if (this.isSafeHeaderValue(authorization)) {
			headers.Authorization = authorization;
		}
		if (this.isSafeHeaderValue(cookie)) {
			headers.Cookie = cookie;
		}

		return headers;
	}

	getFetchOptions(requestOptions = {}) {
		return {
			headers: this.getRequestHeaders(requestOptions),
		};
	}

	getRequestHost(fetchOptions) {
		if (fetchOptions.headers.Cookie) return COOKIE_HOST;
		return fetchOptions.headers.Authorization ? OAUTH_HOST : this.host;
	}

	// A JSON endpoint's path: oauth.reddit.com serves JSON without an
	// extension, www and old reddit need .json.
	jsonPath(pathname, host) {
		return host === OAUTH_HOST ? pathname : `${pathname}.json`;
	}

	// Fetch options for one way of reaching Reddit: { authHeaders } (a cookie
	// or bearer token), { oauthAppId }, or neither (signed out). Null when the
	// OAuth app can't get a token.
	async authorize(requestOptions = {}) {
		if (!requestOptions.oauthAppId) return this.getFetchOptions(requestOptions);
		const token = await getRedditOAuthToken(requestOptions.oauthAppId, this.headers["User-Agent"]);
		return token ? this.getFetchOptions({ authHeaders: { authorization: `Bearer ${token}` } }) : null;
	}

	// Makes a request the way requestOptions names, then, while it fails,
	// each requestOptions.fallback in turn. `isComplete` says whether a
	// result is worth keeping without asking the fallback; when none is, the
	// first result Reddit sent wins.
	async withFallback(requestOptions, attempt, isComplete = () => true) {
		let answer = null;
		for (let options = requestOptions || {}; options; options = options.fallback) {
			const fetchOptions = await this.authorize(options);
			const result = fetchOptions ? ((await attempt(fetchOptions)) ?? null) : null;
			if (result !== null && isComplete(result)) return result;
			answer ??= result;
		}
		return answer;
	}

	// Every request to Reddit. An OAuth token Reddit stops accepting is
	// dropped, so the next request gets a new one.
	async request(url, init) {
		const response = await fetch(url, init);
		if (response.status === 401 && String(url).startsWith(`${OAUTH_HOST}/`)) {
			forgetRedditOAuthToken(String(init.headers.Authorization || "").replace(/^Bearer\s+/i, ""));
		}
		return response;
	}

	// Callers turn a body that isn't JSON into null; the log keeps the status.
	readJson(response, url, request) {
		if (!response.ok) {
			logger.warn(`Reddit refused a ${request} request`, { host: url.hostname, status: response.status });
		}
		return response.json();
	}

	// Things by fullname, as listing JSON, keyed by fullname. Throws when
	// Reddit refuses a batch. Cookies read /api/info.api, which old reddit
	// still serves them; tokens and signed-out requests read /api/info.
	async getThings(names, fetchOptions, request) {
		const things = new Map();
		const host = this.getRequestHost(fetchOptions);
		const pathname = host === COOKIE_HOST ? "/api/info.api" : this.jsonPath("/api/info", host);
		for (let start = 0; start < names.length; start += INFO_BATCH_SIZE) {
			const url = this.buildRedditUrl(
				pathname,
				{ id: names.slice(start, start + INFO_BATCH_SIZE).join(",") },
				host,
			);
			const json = await this.readJson(await this.request(url, fetchOptions), url, request);
			for (const thing of json.data.children) {
				if (typeof thing?.data?.name === "string") things.set(thing.data.name, thing);
			}
		}
		return things;
	}

	// A cookie listing or search: old reddit's page gives the order and next
	// page, /api/info.api the things. `kinds` are the thing types to keep.
	// sr_detail adds each post's community, as it does for a listing.
	async getPageListing(pathname, params, fetchOptions, request, kinds) {
		const { sr_detail: srDetail, ...query } = params;
		const url = this.buildRedditUrl(pathname, query, COOKIE_HOST);
		try {
			const { response, refusedLocation } = await this.fetchListingPage(url, fetchOptions);
			if (!response.ok) {
				logger.warn(`Reddit refused a ${request} request`, {
					host: url.hostname,
					status: response.status,
					...(refusedLocation ? { location: `${refusedLocation.origin}${refusedLocation.pathname}` } : {}),
				});
				return null;
			}
			const page = await readListingPage(await response.text());
			if (!page) {
				logger.warn(`Reddit sent a ${request} page without a listing`, { host: url.hostname, status: response.status });
				return null;
			}

			const names = page.names.filter((name) => kinds.includes(name.slice(0, 2)));
			if (!names.length) return { after: page.after, items: [] };
			const communities = srDetail
				? names.map((name) => page.communities.get(name)).filter(Boolean)
				: [];
			const things = await this.getThings(
				[...new Set([...names, ...communities])],
				fetchOptions,
				request,
			);
			const items = names.map((name) => things.get(name)).filter(Boolean);
			if (srDetail) await this.addCommunities(items, things, fetchOptions, request);
			return { after: page.after, items };
		} catch {
			return null;
		}
	}

	// Follows old reddit's redirects to the same kind of page on its own host,
	// such as a multi's canonical spelling. A missing community redirects to
	// community search, and a signed-out cookie to the login page: those come
	// back unfollowed, with the refused location.
	async fetchListingPage(url, fetchOptions) {
		const requested = url.pathname;
		let target = new URL(url);
		const canonical = this.canonicalPages.get(requested);
		if (canonical) target.pathname = canonical;

		for (let hop = 0; ; hop++) {
			const response = await this.request(target, {
				...fetchOptions,
				headers: { ...fetchOptions.headers, Accept: "text/html" },
				redirect: "manual",
			});
			const location = response.headers.get("location");
			if (response.status < 300 || response.status > 399 || !location) {
				if (response.ok && target.pathname !== requested) this.rememberCanonicalPage(requested, target.pathname);
				return { response };
			}
			const next = new URL(location, target);
			if (hop >= MAX_PAGE_REDIRECTS || next.origin !== COOKIE_HOST || pageKind(next) !== pageKind(url)) {
				return { response, refusedLocation: next };
			}
			target = next;
		}
	}

	rememberCanonicalPage(requested, canonical) {
		this.canonicalPages.delete(requested);
		this.canonicalPages.set(requested, canonical);
		if (this.canonicalPages.size > CANONICAL_PAGES_KEPT) {
			this.canonicalPages.delete(this.canonicalPages.keys().next().value);
		}
	}

	// Search pages don't name a post's community, so those load separately;
	// without them, posts just lack sr_detail.
	async addCommunities(items, things, fetchOptions, request) {
		const posts = items.filter((item) => item.kind === "t3");
		const missing = [...new Set(posts.map((post) => post.data.subreddit_id))].filter(
			(name) => typeof name === "string" && COMMUNITY_NAME.test(name) && !things.has(name),
		);
		if (missing.length) {
			const more = await this.getThings(missing, fetchOptions, request).catch(() => null);
			for (const [name, thing] of more || []) things.set(name, thing);
		}
		for (const post of posts) {
			const community = things.get(post.data.subreddit_id);
			if (community?.kind === "t5") post.data.sr_detail = community.data;
		}
	}

	async getSubmissions(
		sort = "hot",
		subreddit = null,
		options = {},
		requestOptions = {},
	) {
		const params = {
			limit: 20,
			include_over_18: true,
		};

		const safeSort = this.sanitizeSort(sort);
		const safeSubreddit = this.sanitizeSubredditPath(subreddit);
		const encodedSubreddit = this.encodeSubredditPath(safeSubreddit);
		const subredditStr = encodedSubreddit ? `/r/${encodedSubreddit}` : "";
		const query = Object.assign({}, params, options);
		return this.withFallback(requestOptions, async (fetchOptions) => {
			if (fetchOptions.headers.Cookie) {
				const listing = await this.getPageListing(
					`${subredditStr}/${encodeURIComponent(safeSort)}/`,
					query,
					fetchOptions,
					"feed",
					["t3"],
				);
				return listing && { after: listing.after, posts: listing.items };
			}
			const host = this.getRequestHost(fetchOptions);
			const url = this.buildRedditUrl(
				this.jsonPath(`${subredditStr}/${encodeURIComponent(safeSort)}`, host),
				query,
				host,
			);

			return await this.request(url, fetchOptions)
				.then((res) => this.readJson(res, url, "feed"))
				.then((json) => json.data)
				.then((data) => ({
					after: data.after,
					posts: data.children,
				}))
				.catch((err) => null);
		});
	}

	// Posts by id, in the order given, each with its community as sr_detail.
	// Posts Reddit doesn't return (a private community's, say) are left out;
	// null when Reddit refuses.
	async getPostsById(ids, requestOptions = {}) {
		const names = [...new Set(ids.map((id) => this.sanitizeThingId(id)).filter(Boolean))].map(
			(id) => `t3_${id}`,
		);
		if (!names.length) return [];
		return this.withFallback(requestOptions, async (fetchOptions) => {
			try {
				const things = await this.getThings(names, fetchOptions, "saved posts");
				const posts = names.map((name) => things.get(name)).filter((thing) => thing?.kind === "t3");
				await this.addCommunities(posts, things, fetchOptions, "saved posts");
				return posts;
			} catch {
				return null;
			}
		});
	}

	async getSubreddit(subreddit, requestOptions = {}) {
		const safeSubreddit = this.sanitizeSubredditPath(subreddit);
		// Multi-reddits such as home have no about page: Reddit answers 404.
		if (!safeSubreddit || safeSubreddit.includes("+")) return null;
		const encodedSubreddit = this.encodeSubredditPath(safeSubreddit);

		return this.withFallback(requestOptions, async (fetchOptions) => {
			const host = this.getRequestHost(fetchOptions);
			// Refusals aren't logged: a community that doesn't exist 404s.
			return await this.request(
				`${host}/r/${encodedSubreddit}/${this.jsonPath("about", host)}`,
				fetchOptions,
			)
				.then((res) => res.json())
				.then((json) => json.data)
				.catch((err) => null);
		});
	}

	async searchSubmissions(query, options = {}, requestOptions = {}) {
		options.q = query;
		options.type = "link";
		return this.withFallback(requestOptions, async (fetchOptions) => {
			if (fetchOptions.headers.Cookie) {
				return await this.getPageListing("/search", options, fetchOptions, "search", ["t3"]);
			}
			const host = this.getRequestHost(fetchOptions);
			const url = this.buildRedditUrl(this.jsonPath("/search", host), options, host);

			return await this.request(url, fetchOptions)
				.then((res) => this.readJson(res, url, "search"))
				.then((json) => json.data)
				.then((data) => ({
					after: data.after,
					items: data.children,
				}))
				.catch((err) => null);
		});
	}

	async searchSubreddits(query, options = {}, requestOptions = {}) {
		options.q = query;

		const params = {
			limit: 25,
			include_over_18: false,
		};
		Object.assign(params, options);
		// For a while on 2026-11-05 Reddit answered every cookie community
		// search with an empty listing, so an empty result asks the fallback.
		return this.withFallback(
			requestOptions,
			async (fetchOptions) => {
				const host = this.getRequestHost(fetchOptions);
				const url = this.buildRedditUrl(this.jsonPath("/subreddits/search", host), params, host);

				return await this.request(url, fetchOptions)
					.then((res) => this.readJson(res, url, "search"))
					.then((json) => json.data)
					.then((data) => ({
						after: data.after,
						items: data.children,
					}))
					.catch((err) => null);
			},
			(results) => results.items?.length > 0,
		);
	}

	async searchAll(query, subreddit = null, options = {}, requestOptions = {}) {
		const safeSubreddit = this.sanitizeSubredditPath(subreddit);
		// An unusable community must not widen the search to all of Reddit.
		if (subreddit && !safeSubreddit) return null;
		options.q = query;
		const encodedSubreddit = this.encodeSubredditPath(safeSubreddit);
		const subredditStr = encodedSubreddit ? `/r/${encodedSubreddit}` : "";

		const params = {
			limit: 25,
			include_over_18: true,
			type: "sr,link,user",
		};
		Object.assign(params, options);
		return this.withFallback(requestOptions, async (fetchOptions) => {
			if (fetchOptions.headers.Cookie) {
				// The page lists matching communities before posts; it has no users.
				const kinds = String(params.type).split(",").includes("sr") ? ["t5", "t3"] : ["t3"];
				return await this.getPageListing(`${subredditStr}/search`, params, fetchOptions, "search", kinds);
			}
			const host = this.getRequestHost(fetchOptions);
			const url = this.buildRedditUrl(this.jsonPath(`${subredditStr}/search`, host), params, host);

			return await this.request(url, fetchOptions)
				.then((res) => this.readJson(res, url, "search"))
				.then((json) =>
					Array.isArray(json)
						? {
								after: json[1].data.after,
								items: json[0].data.children.concat(json[1].data.children),
							}
						: {
								after: json.data.after,
								items: json.data.children,
							},
				)
				.catch((err) => null);
		});
	}

	async getSubmissionComments(
		id,
		options = this.parameters,
		requestOptions = {},
	) {
		const safeId = this.sanitizeThingId(id);
		if (!safeId) return null;
		return this.withFallback(requestOptions, async (fetchOptions) => {
			const host = this.getRequestHost(fetchOptions);
			const url = this.buildRedditUrl(
				this.jsonPath(`/comments/${encodeURIComponent(safeId)}`, host),
				options,
				host,
			);

			return await this.request(url, fetchOptions)
				.then((res) => this.readJson(res, url, "comments"))
				.then((json) => ({
					submission: json[0].data.children[0],
					comments: json[1].data.children,
				}))
				.catch((err) => null);
		});
	}

	async getMoreComments(id, children, sort, requestOptions = {}) {
		if (
			typeof id !== "string" || !/^[a-z0-9]+$/i.test(id) ||
			!Array.isArray(children) || !children.length ||
			children.length > MORE_COMMENTS_LIMIT ||
			children.some((child) => typeof child !== "string" || !/^[a-z0-9]+$/i.test(child))
		) return null;

		return this.withFallback(requestOptions, async (fetchOptions) => {
			const host = this.getRequestHost(fetchOptions);
			const url = this.buildRedditUrl(
				host === COOKIE_HOST ? "/api/morechildren.api" : this.jsonPath("/api/morechildren", host),
				{
					api_type: "json",
					link_id: `t3_${id}`,
					children: children.join(","),
					sort: commentSort(sort),
				},
				host,
			);
			try {
				const response = await this.request(url, fetchOptions);
				if (!response.ok) {
					logger.warn("Reddit refused a load-more request", { host: url.hostname, status: response.status });
					return null;
				}
				const body = await response.json();
				if (body.json?.errors?.length) return null;
				const things = body.json?.data?.things;
				if (!Array.isArray(things) || !things.every((thing) =>
					["t1", "more"].includes(thing?.kind) && typeof thing.data?.id === "string",
				)) return null;
				return things;
			} catch {
				logger.warn("Reddit load-more request failed", { host: url.hostname });
				return null;
			}
		});
	}

	async getSingleCommentThread(
		parent_id,
		child_id,
		options = this.parameters,
		requestOptions = {},
	) {
		const safeParentId = this.sanitizeThingId(parent_id);
		const safeChildId = this.sanitizeThingId(child_id);
		if (!safeParentId || !safeChildId) return null;
		return this.withFallback(requestOptions, async (fetchOptions) => {
			const host = this.getRequestHost(fetchOptions);
			const url = this.buildRedditUrl(
				this.jsonPath(
					`/comments/${encodeURIComponent(safeParentId)}/comment/${encodeURIComponent(safeChildId)}`,
					host,
				),
				options,
				host,
			);

			return await this.request(url, fetchOptions)
				.then((res) => this.readJson(res, url, "comments"))
				.then((json) => ({
					submission: json[0].data.children[0],
					comments: json[1].data.children,
				}))
				.catch((err) => null);
		});
	}
}

export { Geddit };

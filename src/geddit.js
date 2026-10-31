const logger = require("./logger");
const { MORE_COMMENTS_LIMIT, commentSort } = require("./utils/redditComments");

// www.reddit.com started answering signed-in cookies with its network-security
// block page one endpoint at a time: /api/morechildren (2026-10-23), /r/all
// listings (2026-10-29) and search (2026-10-31). old.reddit.com serves every
// request reddont makes to the same cookie, with the same JSON (checked
// 2026-10-31), so all cookie requests go there. Anonymous requests to
// old.reddit.com redirect to its login page, so only cookie requests go there.
const COOKIE_HOST = "https://old.reddit.com";

class Geddit {
	constructor() {
		this.host = "https://www.reddit.com";
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
		return fetchOptions.headers.Cookie ? COOKIE_HOST : this.host;
	}

	// Callers turn a body that isn't JSON into null; the log keeps the status.
	readJson(response, url, request) {
		if (!response.ok) {
			logger.warn(`Reddit refused a ${request} request`, { host: url.hostname, status: response.status });
		}
		return response.json();
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
		const fetchOptions = this.getFetchOptions(requestOptions);
		const url = this.buildRedditUrl(
			`${subredditStr}/${encodeURIComponent(safeSort)}.json`,
			Object.assign({}, params, options),
			this.getRequestHost(fetchOptions),
		);

		return await fetch(url, fetchOptions)
			.then((res) => this.readJson(res, url, "feed"))
			.then((json) => json.data)
			.then((data) => ({
				after: data.after,
				posts: data.children,
			}))
			.catch((err) => null);
	}

	async getSubreddit(subreddit, requestOptions = {}) {
		const safeSubreddit = this.sanitizeSubredditPath(subreddit);
		if (!safeSubreddit) return null;
		const encodedSubreddit = this.encodeSubredditPath(safeSubreddit);
		const fetchOptions = this.getFetchOptions(requestOptions);

		// Refusals aren't logged: multi-reddits such as home have no about
		// page, so this request 404s on every home page.
		return await fetch(
			`${this.getRequestHost(fetchOptions)}/r/${encodedSubreddit}/about.json`,
			fetchOptions,
		)
			.then((res) => res.json())
			.then((json) => json.data)
			.catch((err) => null);
	}

	async searchSubmissions(query, options = {}, requestOptions = {}) {
		options.q = query;
		options.type = "link";
		const fetchOptions = this.getFetchOptions(requestOptions);
		const url = this.buildRedditUrl(
			"/search.json",
			options,
			this.getRequestHost(fetchOptions),
		);

		return await fetch(url, fetchOptions)
			.then((res) => this.readJson(res, url, "search"))
			.then((json) => json.data)
			.then((data) => ({
				after: data.after,
				items: data.children,
			}))
			.catch((err) => null);
	}

	async searchSubreddits(query, options = {}, requestOptions = {}) {
		options.q = query;

		const params = {
			limit: 25,
			include_over_18: false,
		};
		const fetchOptions = this.getFetchOptions(requestOptions);
		const url = this.buildRedditUrl(
			"/subreddits/search.json",
			Object.assign(params, options),
			this.getRequestHost(fetchOptions),
		);

		return await fetch(url, fetchOptions)
			.then((res) => this.readJson(res, url, "search"))
			.then((json) => json.data)
			.then((data) => ({
				after: data.after,
				items: data.children,
			}))
			.catch((err) => null);
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
		const fetchOptions = this.getFetchOptions(requestOptions);
		const url = this.buildRedditUrl(
			`${subredditStr}/search.json`,
			Object.assign(params, options),
			this.getRequestHost(fetchOptions),
		);

		return await fetch(url, fetchOptions)
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
	}

	async getSubmissionComments(
		id,
		options = this.parameters,
		requestOptions = {},
	) {
		const safeId = this.sanitizeThingId(id);
		if (!safeId) return null;
		const fetchOptions = this.getFetchOptions(requestOptions);
		const url = this.buildRedditUrl(
			`/comments/${encodeURIComponent(safeId)}.json`,
			options,
			this.getRequestHost(fetchOptions),
		);

		return await fetch(url, fetchOptions)
			.then((res) => this.readJson(res, url, "comments"))
			.then((json) => ({
				submission: json[0].data.children[0],
				comments: json[1].data.children,
			}))
			.catch((err) => null);
	}

	async getMoreComments(id, children, sort, requestOptions = {}) {
		if (
			typeof id !== "string" || !/^[a-z0-9]+$/i.test(id) ||
			!Array.isArray(children) || !children.length ||
			children.length > MORE_COMMENTS_LIMIT ||
			children.some((child) => typeof child !== "string" || !/^[a-z0-9]+$/i.test(child))
		) return null;

		const fetchOptions = this.getFetchOptions(requestOptions);
		const url = this.buildRedditUrl(
			"/api/morechildren.json",
			{
				api_type: "json",
				link_id: `t3_${id}`,
				children: children.join(","),
				sort: commentSort(sort),
			},
			this.getRequestHost(fetchOptions),
		);
		try {
			const response = await fetch(url, fetchOptions);
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
		const fetchOptions = this.getFetchOptions(requestOptions);
		const url = this.buildRedditUrl(
			`/comments/${encodeURIComponent(safeParentId)}/comment/${encodeURIComponent(safeChildId)}.json`,
			options,
			this.getRequestHost(fetchOptions),
		);

		return await fetch(url, fetchOptions)
			.then((res) => this.readJson(res, url, "comments"))
			.then((json) => ({
				submission: json[0].data.children[0],
				comments: json[1].data.children,
			}))
			.catch((err) => null);
	}
}

export { Geddit };

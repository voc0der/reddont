const logger = require("./logger");
const { MORE_COMMENTS_LIMIT, commentSort } = require("./utils/redditComments");

// www.reddit.com answers /api/morechildren with its network-security block
// page, even for a signed-in cookie. old.reddit.com serves it to the same
// cookie, for old and new comment IDs alike (checked 2026-10-23).
const MORE_COMMENTS_COOKIE_HOST = "https://old.reddit.com";

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
		const url = this.buildRedditUrl(
			`${subredditStr}/${encodeURIComponent(safeSort)}.json`,
			Object.assign({}, params, options),
		);

		return await fetch(url, this.getFetchOptions(requestOptions))
			.then((res) => res.json())
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

		return await fetch(
			`${this.host}/r/${encodedSubreddit}/about.json`,
			this.getFetchOptions(requestOptions),
		)
			.then((res) => res.json())
			.then((json) => json.data)
			.catch((err) => null);
	}

	async searchSubmissions(query, options = {}, requestOptions = {}) {
		options.q = query;
		options.type = "link";

		return await fetch(
			`${this.host}/search.json?${new URLSearchParams(options)}`,
			this.getFetchOptions(requestOptions),
		)
			.then((res) => res.json())
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

		return await fetch(
			`${this.host}/subreddits/search.json?${new URLSearchParams(Object.assign(params, options))}`,
			this.getFetchOptions(requestOptions),
		)
			.then((res) => res.json())
			.then((json) => json.data)
			.then((data) => ({
				after: data.after,
				items: data.children,
			}))
			.catch((err) => null);
	}

	async searchAll(query, subreddit = null, options = {}, requestOptions = {}) {
		options.q = query;
		const subredditStr = subreddit ? `/r/${subreddit}` : "";

		const params = {
			limit: 25,
			include_over_18: true,
			type: "sr,link,user",
		};

		return await fetch(
			`${this.host + subredditStr}/search.json?${new URLSearchParams(Object.assign(params, options))}`,
			this.getFetchOptions(requestOptions),
		)
			.then((res) => res.json())
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

		return await fetch(
			this.buildRedditUrl(
				`/comments/${encodeURIComponent(safeId)}.json`,
				options,
			),
			this.getFetchOptions(requestOptions),
		)
			.then((res) => res.json())
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
			fetchOptions.headers.Cookie ? MORE_COMMENTS_COOKIE_HOST : this.host,
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

		return await fetch(
			this.buildRedditUrl(
				`/comments/${encodeURIComponent(safeParentId)}/comment/${encodeURIComponent(safeChildId)}.json`,
				options,
			),
			this.getFetchOptions(requestOptions),
		)
			.then((res) => res.json())
			.then((json) => ({
				submission: json[0].data.children[0],
				comments: json[1].data.children,
			}))
			.catch((err) => null);
	}
}

export { Geddit };

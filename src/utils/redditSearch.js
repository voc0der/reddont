// Post search options, as old reddit's search forms and result menus offer
// them: a sort, a time range, NSFW results, and an optional subreddit that
// the search can be limited to.
const SEARCH_SORTS = ["relevance", "hot", "top", "new", "comments"];
const SEARCH_TIMES = ["hour", "day", "week", "month", "year", "all"];

function firstValue(value) {
	return Array.isArray(value) ? value[0] : value;
}

function parseSearchQuery(query = {}) {
	const value = (name) => {
		const v = firstValue(query[name]);
		return typeof v === "string" ? v.trim() : "";
	};
	const sort = value("sort");
	const t = value("t");
	const sr = value("sr").replace(/^\/?r\//i, "");
	const subreddit = /^[A-Za-z0-9_]{1,21}$/.test(sr) ? sr : "";
	const after = /^t3_[A-Za-z0-9]{1,16}$/.test(value("after"))
		? value("after")
		: "";
	return {
		q: value("q"),
		sort: SEARCH_SORTS.includes(sort) ? sort : "relevance",
		t: SEARCH_TIMES.includes(t) ? t : "all",
		subreddit,
		restrict: Boolean(subreddit) && value("restrict_sr") === "on",
		nsfw: value("include_over_18") === "on",
		after,
		count: after ? Math.max(0, Number.parseInt(value("count"), 10) || 0) : 0,
	};
}

// Parameters for reddit's search.json. The NSFW choice is always explicit,
// so an unchecked box excludes adult results whatever the account default.
function searchRequestOptions(search) {
	const options = {
		sort: search.sort,
		t: search.t,
		include_over_18: search.nsfw ? "on" : "off",
	};
	if (search.restrict) {
		options.restrict_sr = "on";
		options.type = "link";
	}
	if (search.after) {
		options.after = search.after;
		options.count = search.count;
	}
	return options;
}

// A results URL for the search with some options changed. Changing the sort,
// time, or scope starts again from the first page.
function searchHref(search, changes = {}, view = "compact") {
	const next = { ...search, after: "", count: 0, ...changes };
	const params = new URLSearchParams({ q: next.q });
	if (next.subreddit) {
		params.set("sr", next.subreddit);
		if (next.restrict) params.set("restrict_sr", "on");
	}
	if (next.nsfw) params.set("include_over_18", "on");
	params.set("sort", next.sort);
	params.set("t", next.t);
	if (next.after) {
		params.set("after", next.after);
		params.set("count", String(next.count));
	}
	params.set("view", view === "card" ? "card" : "compact");
	return `/post-search?${params}`;
}

module.exports = {
	SEARCH_SORTS,
	SEARCH_TIMES,
	parseSearchQuery,
	searchHref,
	searchRequestOptions,
};

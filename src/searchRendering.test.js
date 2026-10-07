const { describe, expect, test } = require("bun:test");
const pug = require("pug");
const { parseSearchQuery, searchHref } = require("./utils/redditSearch");

const user = {
	username: "reader",
	themePreference: "res",
	infiniteScroll: 0,
	highResThumbnails: 1,
	showNsfwThumbnails: 0,
};

const post = {
	kind: "t3",
	data: {
		id: "abc123",
		author: "tester",
		created: Math.floor(Date.now() / 1000) - 120,
		subreddit: "LocalLLaMA",
		title: "A search result",
		domain: "self.LocalLLaMA",
		is_self: true,
		ups: 5,
		num_comments: 2,
		url: "https://www.reddit.com/r/LocalLLaMA/comments/abc123/a/",
		permalink: "/r/LocalLLaMA/comments/abc123/a/",
	},
};

const community = (name, extra = {}) => ({
	kind: "t5",
	data: {
		display_name: name,
		public_description: `About ${name}`,
		subscribers: 1234,
		created_utc: Math.floor(Date.now() / 1000) - 86400 * 70,
		...extra,
	},
});

function renderResults(query, extra = {}) {
	const search = parseSearchQuery(query);
	return pug.renderFile("src/views/post-search.pug", {
		search,
		searchHref: (changes) => searchHref(search, changes, query.view),
		items: [post],
		after: "t3_next",
		communities: [community("DGX_Spark"), community("DGX_Spark_Talk")],
		message: "showing 1 results",
		subscribedSubs: ["dgx_spark_talk"],
		currentUrl: "/post-search",
		user,
		query,
		navSubscriptions: () => [],
		...extra,
	});
}

function params(html, pattern) {
	const href = html.match(pattern)?.[1];
	expect(href).toBeDefined();
	return Object.fromEntries(new URL(href.replaceAll("&amp;", "&"), "http://x").searchParams);
}

describe("post search page", () => {
	test("search page offers sort, time, and NSFW options", () => {
		const html = pug.renderFile("src/views/search.pug", {
			search: parseSearchQuery({}),
			user,
			query: {},
			navSubscriptions: () => [],
		});
		expect(html).toContain('<select name="sort">');
		expect(html).toContain('<option value="relevance" selected="selected">relevance</option>');
		expect(html).toContain('<option value="all" selected="selected">all time</option>');
		expect(html).toContain('<option value="hour">this hour</option>');
		expect(html).toContain('name="include_over_18" value="on"');
		expect(html).not.toContain('name="restrict_sr"');
	});

	test("results keep the chosen options in the form", () => {
		const html = renderResults({ q: "dgx", sort: "top", t: "week", sr: "anticapitalism", include_over_18: "on" });
		expect(html).toContain('value="dgx" required');
		expect(html).toContain('<option value="top" selected="selected">top</option>');
		expect(html).toContain('<option value="week" selected="selected">this week</option>');
		expect(html).toContain("limit my search to r/anticapitalism");
		expect(html).toMatch(/name="restrict_sr" value="on"(?! checked)/);
		expect(html).toMatch(/name="include_over_18" value="on" checked/);
		expect(html).toContain('<input type="hidden" name="sr" value="anticapitalism"/>');
	});

	test("results menus change the sort or time range", () => {
		const html = renderResults({ q: "dgx", sort: "new", t: "week" });
		expect(html).toContain("<summary>new</summary>");
		expect(html).toContain("<summary>past week</summary>");
		expect(params(html, /<a class="choice" href="([^"]+)">comments<\/a>/)).toMatchObject({ q: "dgx", sort: "comments", t: "week" });
		expect(params(html, /<a class="choice" href="([^"]+)">past 24 hours<\/a>/)).toMatchObject({ q: "dgx", sort: "new", t: "day" });
		expect(html).toMatch(/<a class="choice selected" href="[^"]+">past week<\/a>/);
	});

	test("results list matching subreddits with join and search-within links", () => {
		const html = renderResults({ q: "dgx", t: "week" });
		expect(html).toContain('<a href="/r/DGX_Spark?view=compact">DGX_Spark</a>');
		expect(html).toContain('data-join-sub="DGX_Spark" data-joined="0"');
		expect(html).toContain('data-join-sub="DGX_Spark_Talk" data-joined="1"');
		expect(html).toContain("a community for 2 months");
		expect(params(html, /<a class="search-within" href="([^"]+)">search within r\/DGX_Spark<\/a>/)).toMatchObject({
			q: "dgx",
			sr: "DGX_Spark",
			restrict_sr: "on",
			t: "week",
		});
		expect(html).toContain('href="/sub-search?q=dgx&amp;view=compact">next ›</a>');
	});

	test("results page forward with the same options", () => {
		const html = renderResults({ q: "dgx", sort: "top", after: "t3_prev", count: "25" });
		const next = params(html, /<div class="footer-item">.*?<a href="([^"]+)">/s);
		expect(next).toMatchObject({ q: "dgx", sort: "top", after: "t3_next", count: "26" });
	});

	test("an empty search shows the form without results or menus", () => {
		const html = renderResults({}, { items: undefined, communities: undefined, after: undefined, message: undefined });
		expect(html).toContain('class="search-form"');
		expect(html).not.toContain("search-menus");
		expect(html).not.toContain("search-communities");
	});
});

const { describe, expect, test } = require("bun:test");
const {
	parseSearchQuery,
	searchHref,
	searchRequestOptions,
} = require("./redditSearch");

describe("parseSearchQuery", () => {
	test("defaults to relevance over all time without NSFW", () => {
		expect(parseSearchQuery({ q: " dgx spark " })).toEqual({
			q: "dgx spark",
			sort: "relevance",
			t: "all",
			subreddit: "",
			restrict: false,
			nsfw: false,
			after: "",
			count: 0,
		});
	});

	test("keeps supported options and drops the rest", () => {
		expect(
			parseSearchQuery({
				q: "x",
				sort: "comments",
				t: "week",
				sr: "r/LocalLLaMA",
				restrict_sr: "on",
				include_over_18: "on",
				after: "t3_abc123",
				count: "25",
			}),
		).toMatchObject({
			sort: "comments",
			t: "week",
			subreddit: "LocalLLaMA",
			restrict: true,
			nsfw: true,
			after: "t3_abc123",
			count: 25,
		});

		expect(
			parseSearchQuery({
				q: ["first", "second"],
				sort: "hot&t=week",
				t: "decade",
				sr: "../admin",
				restrict_sr: "on",
				after: "t1_comment",
				count: "-5",
			}),
		).toMatchObject({
			q: "first",
			sort: "relevance",
			t: "all",
			subreddit: "",
			restrict: false,
			after: "",
			count: 0,
		});
	});
});

describe("searchRequestOptions", () => {
	test("sends sort, time, and an explicit NSFW choice", () => {
		expect(searchRequestOptions(parseSearchQuery({ q: "x" }))).toEqual({
			sort: "relevance",
			t: "all",
			include_over_18: "off",
		});
	});

	test("limits to the subreddit and continues from a page", () => {
		const search = parseSearchQuery({
			q: "x",
			sort: "top",
			t: "month",
			sr: "test",
			restrict_sr: "on",
			include_over_18: "on",
			after: "t3_next",
			count: "25",
		});
		expect(searchRequestOptions(search)).toEqual({
			sort: "top",
			t: "month",
			include_over_18: "on",
			restrict_sr: "on",
			type: "link",
			after: "t3_next",
			count: 25,
		});
	});

	test("keeps a subreddit unlimited until the box is checked", () => {
		const search = parseSearchQuery({ q: "x", sr: "test" });
		expect(search.subreddit).toBe("test");
		expect(searchRequestOptions(search).restrict_sr).toBeUndefined();
	});
});

describe("searchHref", () => {
	const search = parseSearchQuery({
		q: "dgx spark",
		sort: "new",
		t: "week",
		sr: "test",
		include_over_18: "on",
		after: "t3_page2",
		count: "25",
	});

	test("changes one option and starts from the first page", () => {
		const url = new URL(searchHref(search, { t: "day" }, "card"), "http://x");
		expect(url.pathname).toBe("/post-search");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			q: "dgx spark",
			sr: "test",
			include_over_18: "on",
			sort: "new",
			t: "day",
			view: "card",
		});
	});

	test("searches within a subreddit and pages forward", () => {
		const within = new URL(
			searchHref(search, { subreddit: "Other", restrict: true }),
			"http://x",
		);
		expect(within.searchParams.get("sr")).toBe("Other");
		expect(within.searchParams.get("restrict_sr")).toBe("on");
		expect(within.searchParams.get("view")).toBe("compact");

		const next = new URL(
			searchHref(search, { after: "t3_page3", count: 50 }),
			"http://x",
		);
		expect(next.searchParams.get("after")).toBe("t3_page3");
		expect(next.searchParams.get("count")).toBe("50");
		expect(next.searchParams.get("sort")).toBe("new");
	});
});

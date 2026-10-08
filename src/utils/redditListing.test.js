const { describe, expect, test } = require("bun:test");
const { parseFeedQuery, recentListing } = require("./redditListing");

const NOW = 1800000000;
const WEEK = 7 * 86400;
const post = (id, age = 60, extra = {}) => ({
	kind: "t3",
	data: { id, name: `t3_${id}`, created_utc: NOW - age, ...extra },
});
const ids = (listing) => listing.posts.map((post) => post.data.id);

describe("browser feed options", () => {
	test("defaults to a week and clamps older bookmarked ranges", () => {
		for (const t of [undefined, "month", "year", "all", "invalid", "toString"]) {
			expect(parseFeedQuery({ t })).toEqual({ sort: "hot", t: "week", view: "compact" });
		}
		for (const t of ["hour", "day", "week"]) expect(parseFeedQuery({ t }).t).toBe(t);
	});

	test("validates sort, cursor and view without forwarding arbitrary input", () => {
		expect(parseFeedQuery({ sort: "bad", after: "t1_abc", view: "bad", count: "90", q: "x" }))
			.toEqual({ sort: "hot", t: "week", view: "compact" });
		expect(parseFeedQuery({ sort: ["new", "top"], after: "t3_abc", count: "-5", view: "card" }))
			.toEqual({ sort: "new", t: "week", view: "card", after: "t3_abc", count: 0 });
	});
});

describe("recent native listings", () => {
	test.each(["hot", "new", "rising", "controversial", "top"])("%s excludes expired posts, including pins, without re-ranking", async (sort) => {
		const posts = [
			post("oldpin", WEEK + 1, { stickied: true }),
			post("first", 600, { score: 1 }),
			post("second", 60, { score: 500 }),
			post("boundary", WEEK),
			post("expired", WEEK + 0.001),
			post("unknown", 60, { created_utc: undefined }),
			post("invalid", 60, { created_utc: "yesterday" }),
			post("nan", 60, { created_utc: NaN }),
			post("future", -1),
		];
		const listing = await recentListing(async () => ({ posts, after: null }), { sort }, NOW);
		expect(ids(listing)).toEqual(["first", "second", "boundary"]);
		expect(listing.after).toBeNull();
	});

	test("fills filtered gaps across pages and passes only listing parameters", async () => {
		const calls = [];
		const listing = await recentListing(async (options) => {
			calls.push(options);
			return options.after
				? { posts: Array.from({ length: 24 }, (_, i) => post(`p${i}`)), after: "t3_p23" }
				: { posts: [post("old", WEEK + 1), post("first")], after: "t3_first" };
		}, { sort: "hot", view: "card", currentUrl: "/r/test", t: "all" }, NOW);
		expect(calls).toEqual([
			{ limit: 25, sr_detail: true, t: "week" },
			{ limit: 25, sr_detail: true, t: "week", after: "t3_first", count: 2 },
		]);
		expect(ids(listing)).toEqual(["first", ...Array.from({ length: 24 }, (_, i) => `p${i}`)]);
		expect(listing.after).toBe("t3_p23");
	});

	test("continues past an entirely old hot page and deduplicates overlapping pages", async () => {
		let calls = 0;
		const pages = [
			{ posts: [post("old", WEEK + 1)], after: "t3_old" },
			{ posts: [post("first")], after: "t3_first" },
			{ posts: [post("first"), post("second")], after: null },
		];
		const listing = await recentListing(async () => pages[calls++], { sort: "hot" }, NOW);
		expect(ids(listing)).toEqual(["first", "second"]);
		expect(calls).toBe(3);
	});

	test("does not skip excess upstream posts at the visible page boundary", async () => {
		const source = Array.from({ length: 29 }, (_, i) => post(`p${i}`));
		const getPage = async ({ after }) => ({
			posts: source.slice(after ? source.findIndex((p) => p.data.name === after) + 1 : 0),
			after: null,
		});
		const first = await recentListing(getPage, {}, NOW);
		const next = await recentListing(getPage, { after: first.after, count: 25 }, NOW);
		expect(first.after).toBe("t3_p24");
		expect(ids(first).concat(ids(next))).toEqual(source.map((p) => p.data.id));
		expect(next.after).toBeNull();
	});

	test("new stops at the age boundary but not at an expired announcement", async () => {
		let calls = 0;
		const pages = [
			{ posts: [post("pin", WEEK + 1, { stickied: true }), post("first")], after: "t3_first" },
			{ posts: [post("boundary", WEEK), post("old", WEEK + 1)], after: "t3_old" },
		];
		const listing = await recentListing(async () => pages[calls++], { sort: "new" }, NOW);
		expect(ids(listing)).toEqual(["first", "boundary"]);
		expect(listing.after).toBeNull();
		expect(calls).toBe(2);
	});

	test("enforces the narrower hour and day ranges locally too", async () => {
		for (const [t, age] of [["hour", 3600], ["day", 86400]]) {
			const listing = await recentListing(async () => ({ posts: [post("edge", age), post("old", age + 1)], after: null }), { t }, NOW);
			expect(ids(listing)).toEqual(["edge"]);
		}
	});

	test("bounds sparse scans while keeping an advancing continuation", async () => {
		let calls = 0;
		const listing = await recentListing(async () => ({ posts: [post(`old${++calls}`, WEEK + 1)], after: `t3_old${calls}` }), {}, NOW);
		expect(calls).toBe(5);
		expect(ids(listing)).toEqual([]);
		expect(listing.after).toBe("t3_old5");
	});

	test("stops on repeated cursors, including a cursor supplied by the browser", async () => {
		let calls = 0;
		const listing = await recentListing(async () => {
			calls++;
			return { posts: [], after: "t3_start" };
		}, { after: "t3_start" }, NOW);
		expect(listing).toEqual({ posts: [], after: null, expiresAt: null });
		expect(calls).toBe(1);
	});

	test("keeps an empty success distinct from upstream failure, including during refill", async () => {
		expect(await recentListing(async () => ({ posts: [], after: null }), {}, NOW)).toEqual({ posts: [], after: null, expiresAt: null });
		for (const failed of [null, {}, { posts: {} }]) {
			expect(await recentListing(async () => failed, {}, NOW)).toBeNull();
			expect(await recentListing(async ({ after }) => after ? failed : { posts: [post("first")], after: "t3_first" }, {}, NOW)).toBeNull();
		}
	});

	test("expires restored pages when the oldest displayed post leaves the range", async () => {
		for (const [t, age] of [["hour", 3600], ["day", 86400], ["week", WEEK]]) {
			const listing = await recentListing(async () => ({ posts: [post("first", 60), post("oldest", age - 10)], after: null }), { t }, NOW);
			expect(listing.expiresAt).toBe((NOW + 10) * 1000);
		}
	});
});

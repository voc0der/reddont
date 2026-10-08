const FEED_SORTS = ["hot", "new", "rising", "controversial", "top"];
const FEED_TIMES = { hour: 3600, day: 86400, week: 7 * 86400 };
const COMMUNITY_TIMES = ["hour", "day", "week", "month", "year", "all"];
const MAX_FEED_PAGES = 5;

function firstValue(value) {
	return Array.isArray(value) ? value[0] : value;
}

function isRecentFeed(subreddit) {
	return ["all", "popular"].includes(String(subreddit).toLowerCase());
}

// Home, all and popular have a hard age cap. Community listings must remain
// useful when they are quiet.
function parseFeedQuery(query = {}, recentOnly = false) {
	const sort = firstValue(query.sort);
	const time = firstValue(query.t);
	const after = firstValue(query.after);
	return {
		sort: FEED_SORTS.includes(sort) ? sort : "hot",
		t: recentOnly
			? (Object.hasOwn(FEED_TIMES, time) ? time : "week")
			: (COMMUNITY_TIMES.includes(time) ? time : "all"),
		view: firstValue(query.view) === "card" ? "card" : "compact",
		...(typeof after === "string" && /^t3_[a-z0-9]+$/i.test(after)
			? { after, count: Math.max(0, Number.parseInt(firstValue(query.count), 10) || 0) }
			: {}),
	};
}

async function browserListing(getPage, query, recentOnly, now = Date.now() / 1000) {
	if (recentOnly) return recentListing(getPage, query, now);

	const { t, after, count } = parseFeedQuery(query);
	const listing = await getPage({ limit: 25, t, sr_detail: true, ...(after ? { after, count } : {}) });
	if (!Array.isArray(listing?.posts)) return null;
	const recent = [];
	const older = [];
	for (const post of listing.posts) {
		const created = post?.data?.created_utc;
		const fresh = typeof created === "number" && created >= now - FEED_TIMES.week && created <= now;
		(fresh ? recent : older).push(post);
	}
	// Stable partition within the upstream page for every sort: keep every
	// post and its original cursor, so reordering cannot skip older posts.
	return { ...listing, posts: recent.concat(older), expiresAt: null };
}

function postName(post) {
	return post?.data?.name || (post?.data?.id ? `t3_${post.data.id}` : "");
}

// Filter the native listing in place: hot/rising are not chronological, so
// neither re-sort by date/score nor stop at their first expired post. Fetch
// ahead to fill gaps without skipping eligible posts at a page boundary.
// The JSON/RSS API deliberately keeps its independent historical time ranges.
async function recentListing(getPage, query, now = Date.now() / 1000) {
	const { sort, t, after: initialAfter, count = 0 } = parseFeedQuery(query, true);
	const cutoff = now - FEED_TIMES[t];
	const limit = 25;
	const posts = [];
	const seenPosts = new Set();
	const seenCursors = new Set(initialAfter ? [initialAfter] : []);
	let after = initialAfter;
	let scanned = count;
	const result = (after) => ({
		posts,
		after,
		// Back-navigation snapshots expire as soon as their oldest post ages
		// out. The browser must not restore results beyond the selected range.
		expiresAt: posts.length
			? (Math.min(...posts.map((post) => post.data.created_utc)) + FEED_TIMES[t]) * 1000
			: null,
	});

	for (let page = 0; page < MAX_FEED_PAGES; page++) {
		const listing = await getPage({
			limit,
			t,
			sr_detail: true,
			...(after ? { after, count: scanned } : {}),
		});
		if (!Array.isArray(listing?.posts)) return null;

		let reachedCutoff = false;
		let next = listing.after || null;
		for (let index = 0; index < listing.posts.length; index++) {
			const post = listing.posts[index];
			const created = post?.data?.created_utc;
			const name = postName(post);
			scanned++;
			if (typeof created !== "number" || !Number.isFinite(created)) continue;
			if (created < cutoff) {
				if (sort === "new" && !post.data.stickied) reachedCutoff = true;
				continue;
			}
			if (created > now || !name || seenPosts.has(name)) continue;
			seenPosts.add(name);
			posts.push(post);
			if (posts.length === limit) {
				// A refill can contain more recent posts than this page needs.
				if (index < listing.posts.length - 1) next = name;
				break;
			}
		}

		if (reachedCutoff || !next || seenCursors.has(next)) {
			return result(null);
		}
		after = next;
		seenCursors.add(after);
		if (posts.length === limit) break;
	}

	// A bounded scan keeps sparse feeds responsive; the continuation still
	// points after the last consumed post, even when this page is empty.
	return result(after);
}

module.exports = { browserListing, isRecentFeed, parseFeedQuery, recentListing };

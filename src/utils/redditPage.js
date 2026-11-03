// Old reddit's listing and search pages name their things in order and link
// the next page. That is all reddont reads from a page: the things themselves
// come from /api/info.json, as the same JSON a listing returns.
const THING_NAME = /^t[35]_[a-z0-9]+$/;
const COMMUNITY_NAME = /^t5_[a-z0-9]+$/;

function nextCursor(href) {
	if (!href) return null;
	try {
		const url = new URL(href.replaceAll("&amp;", "&"), "https://old.reddit.com");
		const after = url.searchParams.get("after");
		return after && THING_NAME.test(after) ? after : null;
	} catch {
		return null;
	}
}

// Resolves to the page's thing fullnames in order (ads skipped), each post's
// community fullname where the page gives one, and the next-page cursor.
// Resolves to null for a page without a listing, such as a login page.
async function readListingPage(html) {
	const names = [];
	const communities = new Map();
	let after;
	let hasListing = false;

	const listing = {
		element() {
			hasListing = true;
		},
	};
	const thing = {
		element(element) {
			const name = element.getAttribute("data-fullname");
			if (!name || !THING_NAME.test(name) || names.includes(name)) return;
			if (element.getAttribute("data-promoted") === "true") return;
			names.push(name);
			const community = element.getAttribute("data-subreddit-fullname");
			if (community && COMMUNITY_NAME.test(community)) communities.set(name, community);
		},
	};

	await new HTMLRewriter()
		.on("#siteTable", listing)
		.on(".search-result-listing", listing)
		.on("#noresults", listing)
		.on("#siteTable .thing[data-fullname]", thing)
		.on(".search-result[data-fullname]", thing)
		// A page has one next link; only the first one counts.
		.on('a[rel~="next"]', {
			element(element) {
				if (after === undefined) after = nextCursor(element.getAttribute("href"));
			},
		})
		.transform(new Response(html))
		.arrayBuffer();

	return hasListing ? { names, communities, after: after ?? null } : null;
}

module.exports = { readListingPage };

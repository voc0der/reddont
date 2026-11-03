const { describe, expect, test } = require("bun:test");
const { readListingPage } = require("./redditPage");

// Trimmed from old.reddit.com pages as served on 2026-11-03.
const listingPage = `<!doctype html><html><head><link rel="next" href="/head?after=t3_head"></head><body>
<div class="side"><div class=" thing id-t3_side link" data-fullname="t3_side" data-type="link"></div></div>
<div class="content" role="main"><div id="siteTable" class="sitetable linklisting">
<div class=" thing id-t3_ad promoted link" data-fullname="t3_ad" data-type="link" data-promoted="true" data-subreddit-fullname="t5_ads"></div>
<div class=" thing id-t3_first linkflair odd&#32; link self" id="thing_t3_first" onclick="click_thing(this)" data-fullname="t3_first" data-type="link" data-subreddit="linux" data-subreddit-fullname="t5_linux" data-promoted="false"><a class="title" href="/r/linux/comments/first/">First</a></div>
<div class="clearleft"></div>
<div class=" thing id-t3_second even&#32; link" id="thing_t3_second" data-fullname="t3_second" data-type="link" data-subreddit-fullname="t5_bsd" data-promoted="false"></div>
<div class=" thing id-t3_first odd&#32; link" data-fullname="t3_first" data-type="link" data-promoted="false"></div>
<script id="crosspost-thing-preview" type="text/template"><div class="crosspost-thing-preview thing" data-fullname="t3_template"></div></script>
<div class="nav-buttons"><span class="nextprev">view more:&#32;<span class="next-button"><a href="https://old.reddit.com/r/linux/new/?limit=5&amp;count=5&amp;after=t3_second" rel="nofollow next" >next &rsaquo;</a></span></span></div>
</div></div></body></html>`;

const searchPage = `<!doctype html><html><body><div class="content" role="main">
<div class=" listing search-result-listing">
<div class="search-result-group"><header class="search-result-group-header">subreddits</header>
<div class=" search-result search-result-subreddit" data-fullname="t5_linux"><div class="search-result-meta"></div></div></div>
<div class="search-result-group">
<div class=" search-result search-result-link has-thumbnail no-linkflair" data-fullname="t3_found"><div class="search-result-meta"></div><div class="search-result-body"></div></div>
<div class=" search-result search-result-link has-linkflair" data-fullname="t3_also"><div class="search-result-footer"></div></div>
</div>
<footer><div class="nav-buttons"><span class="nextprev">view more:&#32;<a href="https://old.reddit.com/search?q=linux&amp;type=link&amp;sort=new&amp;count=25&amp;after=t3_also" rel="nofollow next" >next &rsaquo;</a></span></div></footer>
</div></div></body></html>`;

describe("old reddit pages", () => {
	test("list a feed's posts in order, without ads, with their communities and next page", async () => {
		const page = await readListingPage(listingPage);

		expect(page.names).toEqual(["t3_first", "t3_second"]);
		expect(Object.fromEntries(page.communities)).toEqual({ t3_first: "t5_linux", t3_second: "t5_bsd" });
		expect(page.after).toBe("t3_second");
	});

	test("list a search's communities and posts in order with the next page", async () => {
		const page = await readListingPage(searchPage);

		expect(page.names).toEqual(["t5_linux", "t3_found", "t3_also"]);
		expect(page.communities.size).toBe(0);
		expect(page.after).toBe("t3_also");
	});

	test("read an empty listing as no posts and no next page", async () => {
		const empty = '<div id="siteTable" class="sitetable linklisting"><p id="noresults" class="error">there doesn\'t seem to be anything here</p></div>';

		expect(await readListingPage(empty)).toEqual({ names: [], communities: new Map(), after: null });
		expect(await readListingPage('<p id="noresults" class="error">no results</p>')).toEqual({
			names: [],
			communities: new Map(),
			after: null,
		});
	});

	test("reject pages without a listing and unusable names or cursors", async () => {
		expect(await readListingPage('<form id="login-form"><div class="thing" data-fullname="t3_a"></div></form>')).toBeNull();
		expect(await readListingPage("")).toBeNull();

		const odd = await readListingPage(`<div id="siteTable">
			<div class="thing" data-fullname="t1_comment"></div>
			<div class="thing" data-fullname="t3_ok" data-subreddit-fullname="bogus"></div>
			<div class="thing" data-fullname="t3_bad name"></div>
			<a rel="next" href="/r/x/?after=javascript:alert(1)">next</a>
			<a rel="next" href="/r/x/?after=t3_later">next</a>
		</div>`);
		expect(odd.names).toEqual(["t3_ok"]);
		expect(odd.communities.size).toBe(0);
		expect(odd.after).toBeNull();
		expect((await readListingPage('<div id="siteTable"><a rel="next" href="http://[">next</a></div>')).after).toBeNull();
	});
});

const { describe, expect, test } = require("bun:test");
const pug = require("pug");

const user = {
	username: "reader",
	themePreference: "res",
	infiniteScroll: 1,
	highResThumbnails: 1,
	showNsfwThumbnails: 0,
};

function comment(id, extra = {}, replies = []) {
	return {
		kind: "t1",
		data: {
			id,
			author: `author_${id}`,
			ups: 3,
			score: 3,
			created: Math.floor(Date.now() / 1000) - 3600,
			edited: false,
			body_html: `<div class="md"><p>body ${id}</p></div>`,
			permalink: `/r/test/comments/post1/title/${id}/`,
			replies: replies.length ? { data: { children: replies } } : "",
			...extra,
		},
	};
}

function renderComments(comments) {
	return pug.renderFile("src/views/comments.pug", {
		data: {
			post: {
				id: "post1",
				author: "op",
				created: Math.floor(Date.now() / 1000) - 7200,
				subreddit: "test",
				title: "A post",
				domain: "self.test",
				is_self: true,
				ups: 10,
				score: 10,
				num_comments: 4,
				url: "https://www.reddit.com/r/test/comments/post1/a_post/",
				permalink: "/r/test/comments/post1/a_post/",
			},
			comments,
		},
		isSubbed: false,
		user,
		query: {},
		navSubscriptions: () => ["test", "Other"],
	});
}

function renderFeed(query, currentUrl, extra = {}) {
	return pug.renderFile("src/views/index.pug", {
		subreddit: "test",
		posts: {
			after: "t3_next",
			posts: [
				{
					data: {
						id: "abc123",
						author: "tester",
						created: Math.floor(Date.now() / 1000) - 120,
						subreddit: "test",
						title: "A text post",
						domain: "self.test",
						is_self: true,
						ups: 1,
						num_comments: 0,
						url: "https://www.reddit.com/r/test/comments/abc123/a/",
						permalink: "/r/test/comments/abc123/a/",
					},
				},
			],
		},
		about: null,
		query,
		isMulti: false,
		user,
		isSubbed: false,
		subscribedSubs: [],
		currentUrl,
		navSubscriptions: () => ["test", "Other"],
		...extra,
	});
}

describe("desktop comments", () => {
	test("badge the submitter and moderators as old reddit does", () => {
		const html = renderComments([
			comment("c1", { is_submitter: true }),
			comment("c2", { distinguished: "moderator" }),
		]);

		expect(html).toContain('class="author submitter"');
		expect(html).toContain('<span class="submitter" title="submitter">S</span>');
		expect(html).toContain('class="author moderator"');
		expect(html).toContain('<span class="moderator" title="moderator">M</span>');
	});

	test("count every descendant for the collapsed tagline", () => {
		const html = renderComments([
			comment("c1", {}, [
				comment("c2", { parent_id: "t1_c1" }, [comment("c3", { parent_id: "t1_c2" })]),
				{ kind: "more", data: { id: "m1", count: 5, parent_id: "t1_c1" } },
			]),
		]);

		expect(html).toContain('<span class="numchildren">(7 children)</span>');
	});

	test("link the permalink, parent, and reddit buttons", () => {
		const html = renderComments([comment("c1", {}, [comment("c2", { parent_id: "t1_c1" })])]);

		expect(html).toContain('<a href="/comments/post1/comment/c2">permalink</a>');
		expect(html).toContain('<a href="#c1">parent</a>');
		expect(html).toContain('<a href="https://www.reddit.com/r/test/comments/post1/title/c2/">reddit</a>');
		expect(html).toContain('onclick="toggleChildComments(this)"');
	});
});

describe("desktop header", () => {
	test("list subscriptions and mark the current page", () => {
		const html = renderFeed({ sort: "new", view: "compact" }, "/r/test");

		expect(html).toContain('<a href="/r/Other?view=compact">Other</a>');
		expect(html).toContain('<a class="selected" href="/r/test?view=compact">test</a>');
		expect(html).toContain('<li class="selected"><a href="/r/test?sort=new&amp;view=compact">new</a></li>');
		expect(html).toContain('<a href="/r/test?sort=new&amp;view=card">show images</a>');
	});

	test("list subscriptions in the my subreddits menu, as RES does", () => {
		const html = renderFeed({ sort: "hot", view: "compact" }, "/r/test");

		expect(html).toContain('placeholder="Filter subreddits..."');
		expect(html).toContain('<a class="sr-list-all" href="/subs?view=compact">View all »</a>');
		expect(html).toContain(
			'<tr data-sub="other"><td><a href="/r/Other?view=compact">Other</a></td><td class="sr-visited">N/A</td></tr>',
		);
	});

	test("say so when there are no subscriptions", () => {
		const html = renderFeed({ sort: "hot", view: "compact" }, "/r/test", { navSubscriptions: () => [] });

		expect(html).toContain('<td class="sr-list-empty" colspan="2">no subscriptions yet</td>');
	});

	test("count community and comment pages as visits, but not home", () => {
		const home = renderFeed({ sort: "hot", view: "compact" }, "/", {
			subreddit: "test+Other",
			isMulti: true,
			isHomePage: true,
		});

		expect(renderFeed({ sort: "hot", view: "compact" }, "/r/test")).toContain(
			'<div class="d-only" id="sr-header-area" data-subreddit="test">',
		);
		expect(renderComments([])).toContain('<div class="d-only" id="sr-header-area" data-subreddit="test">');
		expect(home).toContain('<div class="d-only" id="sr-header-area">');
		expect(home).toContain('data-subreddit="home"');
	});
});

describe("feed paging", () => {
	test("offers only hour, day and week feed ranges and defaults to week", () => {
		const html = renderFeed({ sort: "top", view: "compact" }, "/r/test");
		const menu = html.match(/<div class="menuarea d-only">[\s\S]*?<div id="posts-container"/)[0];
		expect(menu).toContain("<summary>past week</summary>");
		for (const range of ["hour", "day", "week"]) expect(menu).toContain(`&amp;t=${range}`);
		for (const range of ["month", "year", "all"]) {
			expect(menu).not.toContain(`&amp;t=${range}`);
			expect(html).not.toContain(`top ${range}</a>`);
		}
		expect(html).toContain('href="/r/test?sort=controversial&amp;view=compact"');
	});

	test("keeps a manual continuation on empty filtered pages even with infinite scroll enabled", () => {
		const html = renderFeed({ sort: "hot", t: "week", view: "compact" }, "/r/test", {
			posts: { posts: [], after: "t3_next" },
		});
		expect(html).toContain("No posts from the past week on this page.");
		expect(html).toContain('href="/r/test?sort=hot&amp;t=week&amp;view=compact&amp;after=t3_next&amp;count=0"');
		expect(html).not.toContain('id="infinite-scroll-sentinel"');
	});

	test("carry the post count into the next page for ranks", () => {
		const html = renderFeed({ sort: "hot", view: "compact", count: "25" }, "/r/test");

		expect(html).toContain('<span class="rank d-only">26</span>');
		expect(html).toContain('data-count="25"');
	});

	test("keep request values out of the infinite scroll script", () => {
		const hostile = "hot';alert(1)//";
		const html = renderFeed({ sort: hostile, view: "compact" }, `/r/test?sort=${hostile}`);
		const scripts = html.match(/<script>[\s\S]*?<\/script>/g).join("\n");

		expect(scripts).not.toContain("alert(1)");
		expect(html).toContain('data-sort="hot\';alert(1)//"');
	});
});

describe("sidebar search", () => {
	test("start limited to the community on its pages", () => {
		const html = renderFeed({ sort: "hot" }, "/r/test");
		expect(html).toContain("limit my search to r/test");
		expect(html).toContain('name="restrict_sr" value="on" checked');
		expect(html).toContain('<input type="hidden" name="sr" value="test"/>');
		expect(html).toContain('<select name="sort">');
	});

	test("search everything from home", () => {
		const html = renderFeed({ sort: "hot" }, "/", { isHomePage: true });
		expect(html).not.toContain('name="restrict_sr"');
		expect(html).toContain('name="include_over_18" value="on"');
	});
});

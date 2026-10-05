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

function renderFeed(query, currentUrl) {
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
});

describe("feed paging", () => {
	test("carry the post count into the next page for ranks", () => {
		const html = renderFeed({ sort: "hot", view: "compact", count: "25" }, "/r/test");

		expect(html).toContain('<span class="rank d-only">26</span>');
	});

	test("keep request values out of the infinite scroll script", () => {
		const hostile = "hot';alert(1)//";
		const html = renderFeed({ sort: hostile, view: "compact" }, `/r/test?sort=${hostile}`);
		const scripts = html.match(/<script>[\s\S]*?<\/script>/g).join("\n");

		expect(scripts).not.toContain("alert(1)");
		expect(html).toContain('data-sort="hot\';alert(1)//"');
	});
});

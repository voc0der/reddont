const { describe, expect, test } = require("bun:test");
const pug = require("pug");

function basePost() {
	return {
		id: "abc123",
		author: "tester",
		created: Math.floor(Date.now() / 1000) - 120,
		subreddit: "test",
		title: "A text post",
		domain: "self.test",
		is_self: true,
		selftext_html: "<p>Hello preview</p>",
		ups: 42,
		num_comments: 7,
		gilded: 0,
		url: "https://www.reddit.com/r/test/comments/abc123/a_text_post/",
		permalink: "/r/test/comments/abc123/a_text_post/",
	};
}

function renderPost(overrides = {}, view = "compact", subreddit) {
	return pug.renderFile("src/views/posts-partial.pug", {
		posts: [{ data: { ...basePost(), ...overrides } }],
		currentUrl: `/r/test?view=${view}`,
		query: { view, sort: "hot" },
		subreddit,
		user: { highResThumbnails: 1, showNsfwThumbnails: 0 },
	});
}

describe("compact text posts", () => {
	test("render a discussion link and a separate inline-preview control", () => {
		const html = renderPost();

		expect(html).toContain("self-post-preview");
		expect(html).toContain("self-post-link");
		expect(html).toContain('href="/comments/abc123?');
		expect(html).toContain("self-post-expando");
		expect(html).toContain('aria-controls="abc123"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain('<div class="self-post-body self-text">');
		expect(html).toContain("<p>Hello preview</p>");
	});

	test("keep the discussion link but omit the expando for an empty post", () => {
		const html = renderPost({ selftext_html: null });

		expect(html).toContain("self-post-link");
		expect(html).not.toContain("self-post-expando");
		expect(html).not.toContain("self-post-body");
	});

	test("render text from a crosspost parent while linking to the local post", () => {
		const html = renderPost({
			is_self: false,
			selftext_html: null,
			crosspost_parent_list: [
				{
					is_self: true,
					selftext_html: "<p>Parent preview</p>",
					over_18: true,
					url: "https://www.reddit.com/r/source/comments/parent/source_post/",
				},
			],
		});

		expect(html).toContain("self-post-link");
		expect(html).toContain('href="/comments/abc123?');
		expect(html).toContain("Reveal NSFW text");
		expect(html).toContain('id="preview_text_abc123" hidden="hidden"');
		expect(html).toContain("<p>Parent preview</p>");
	});

	test("preserve body text on native link posts in card view", () => {
		const html = renderPost(
			{
				is_self: false,
				post_hint: "link",
				domain: "example.com",
				url: "https://example.com/story",
				selftext_html: "<p>Link-post body</p>",
			},
			"card",
		);

		expect(html).toContain("<p>Link-post body</p>");
	});

	test("treat a link post with no post_hint as a link", () => {
		const html = renderPost({
			is_self: false,
			selftext_html: null,
			domain: "bhphotovideo.com",
			url: "https://www.bhphotovideo.com/c/product/1234",
			thumbnail: "default",
		});

		expect(html).toContain("link-preview");
		expect(html).toContain('href="https://www.bhphotovideo.com/c/product/1234"');
		expect(html).toContain("external-action");
	});

	test("do not mistake a reddit-hosted post for an off-site link", () => {
		const html = renderPost();

		expect(html).not.toContain("link-preview");
		expect(html).not.toContain("external-action");
	});

	test("lazy-load inline images in rendered previews", () => {
		const imageUrl = "https://i.redd.it/example.png";
		const html = renderPost({
			selftext_html: `<p><a href="${imageUrl}">${imageUrl}</a></p>`,
		});

		expect(html).toContain('loading="lazy"');
		expect(html).toContain('decoding="async"');
	});
});

describe("desktop listing", () => {
	test("number posts from the page offset and print old reddit scores", () => {
		const html = pug.renderFile("src/views/posts-partial.pug", {
			posts: [{ data: { ...basePost(), score: 12403, ups: 12403 } }],
			currentUrl: "/r/test",
			query: { view: "compact", sort: "hot", count: "25" },
			user: { highResThumbnails: 1, showNsfwThumbnails: 0 },
		});

		expect(html).toContain('<span class="rank d-only">26</span>');
		expect(html).toContain('<span class="score">12.4k</span>');
	});

	test("credit the community in mixed feeds and link the comments", () => {
		const html = renderPost({}, "compact", "all");

		expect(html).toContain("submitted <time");
		expect(html).toContain('<a class="author" href="https://www.reddit.com/user/tester">tester</a>');
		expect(html).toContain('to <a class="subreddit" href="/r/test?view=compact">r/test</a>');
		expect(html).toMatch(/<a class="comments" href="\/comments\/abc123\?[^"]*">7 comments<\/a>/);
	});

	test("leave the community out within its own feed", () => {
		const html = renderPost({}, "compact", "test");

		expect(html).not.toContain('class="subreddit"');
	});

	test("give media and text posts an expando button, but not links", () => {
		const text = renderPost();
		const image = renderPost({
			is_self: false,
			post_hint: "image",
			url: "https://i.redd.it/example.png",
			thumbnail: "https://b.thumbs.redditmedia.com/example.jpg",
		});
		const link = renderPost({
			is_self: false,
			post_hint: "link",
			url: "https://example.com/story",
		});

		expect(text).toContain('class="expando-button d-only selftext"');
		expect(image).toContain('class="expando-button d-only image"');
		expect(image).toContain('aria-controls="abc123" aria-expanded="false"');
		expect(link).not.toContain("expando-button");
	});

	test("keep a coloured flair's colour for the desktop label", () => {
		const html = renderPost({
			link_flair_text: "Discussion",
			link_flair_background_color: "#46d160",
			link_flair_text_color: "dark",
		});

		expect(html).toContain(
			'<span class="linkflairlabel d-only is-dark" title="Discussion" style="--flair-color:#46d160">Discussion</span>',
		);
	});
});

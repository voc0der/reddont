const { describe, expect, test } = require("bun:test");
const pug = require("pug");
const { proxiedMediaUrl } = require("./mediaProxy");

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

function renderPost(overrides = {}, view = "compact", subreddit, locals = {}) {
	return pug.renderFile("src/views/posts-partial.pug", {
		posts: [{ data: { ...basePost(), ...overrides } }],
		currentUrl: `/r/test?view=${view}`,
		query: { view, sort: "hot" },
		subreddit,
		user: { highResThumbnails: 1, showNsfwThumbnails: 0 },
		...locals,
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

function galleryPost(overrides = {}) {
	return {
		is_self: false,
		selftext_html: null,
		is_gallery: true,
		domain: "reddit.com",
		url: "https://www.reddit.com/gallery/abc123",
		thumbnail: "https://b.thumbs.redditmedia.com/gallery.jpg",
		gallery_data: {
			items: [
				{ media_id: "first", id: 1 },
				{ media_id: "second", id: 2 },
			],
		},
		// Reddit can leave a gallery item out of media_metadata (issue #41).
		media_metadata: {
			first: { status: "valid", e: "Image", m: "image/png" },
		},
		...overrides,
	};
}

function renderPostPage(overrides = {}, locals = {}) {
	return pug.renderFile("src/views/comments.pug", {
		data: { post: { ...basePost(), ...overrides }, comments: [] },
		isSubbed: false,
		user: { username: "reader", highResThumbnails: 1, showNsfwThumbnails: 0 },
		query: {},
		navSubscriptions: () => ["test"],
		...locals,
	});
}

describe("links to a post's URL", () => {
	test("keep http and https URLs, and drop any other scheme's href", () => {
		const link = { is_self: false, domain: "example.com", post_hint: "link" };
		for (const html of [renderPost({ ...link, url: "https://example.com/a?b=1" }, "card"), renderPostPage({ ...link, url: "https://example.com/a?b=1" })]) {
			expect(html).toContain('href="https://example.com/a?b=1"');
		}
		for (const url of ["javascript:alert(1)", " JaVa\tScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x"]) {
			for (const html of [renderPost({ ...link, url }, "card"), renderPost({ ...link, url }), renderPostPage({ ...link, url })]) {
				expect(html).not.toMatch(/href="\s*(javascript|data|vbscript):/i);
				expect(html).not.toContain("alert(1)\"");
			}
		}
	});
});

describe("gallery posts", () => {
	test("render in a listing when the metadata leaves out an item", () => {
		const html = renderPost(galleryPost());

		expect(html).toContain('src="https://i.redd.it/first.png"');
		expect(html).toContain('src="https://i.redd.it/second.jpg"');
		expect(html).toContain("1 of 2");
	});

	test("render on the post page when the metadata leaves out an item", () => {
		const html = renderPostPage(galleryPost());

		expect(html).toContain('src="https://i.redd.it/first.png"');
		expect(html).toContain('src="https://i.redd.it/second.jpg"');
		expect(html).toContain("1 of 2");
	});

	test("show a gallery with no items as a plain post", () => {
		const empty = { gallery_data: null, media_metadata: null };
		const listing = renderPost(galleryPost(empty));
		const page = renderPostPage(galleryPost(empty));

		expect(listing).not.toContain('class="gallery"');
		expect(listing).not.toContain("expando-button");
		expect(page).not.toContain('class="gallery"');
	});
});

describe("with the media proxy on", () => {
	const proxied = { mediaProxyUrl: proxiedMediaUrl };
	// An attribute or style that loads media from one of Reddit's hosts.
	const directMedia =
		/(?:src|poster|data-[a-z-]+)="https?:\/\/[^"]*(?:redd\.it|redditmedia\.com|redditstatic\.com)|url\((?:&quot;|")?https?:\/\/[^)]*(?:redd\.it|redditmedia\.com|redditstatic\.com)/;
	const imagePost = {
		is_self: false,
		selftext_html: null,
		post_hint: "image",
		domain: "i.redd.it",
		url: "https://i.redd.it/example.png",
		thumbnail: "https://b.thumbs.redditmedia.com/example.jpg",
		preview: {
			images: [
				{
					source: { url: "https://preview.redd.it/example.png?width=1080&amp;s=big", width: 1080, height: 720 },
					resolutions: [{ url: "https://preview.redd.it/example.png?width=640&amp;s=small", width: 640, height: 427 }],
				},
			],
		},
	};
	const videoPost = {
		is_self: false,
		selftext_html: null,
		post_hint: "hosted:video",
		is_video: true,
		domain: "v.redd.it",
		url: "https://v.redd.it/clip",
		secure_media: {
			reddit_video: {
				hls_url: "https://v.redd.it/clip/HLSPlaylist.m3u8?a=1&amp;v=1",
				dash_url: "https://v.redd.it/clip/DASHPlaylist.mpd?a=1&amp;v=1",
				fallback_url: "https://v.redd.it/clip/DASH_720.mp4?source=fallback",
				scrubber_media_url: "https://v.redd.it/clip/DASH_96.mp4",
				width: 1280,
				height: 720,
			},
		},
		preview: {
			images: [{ source: { url: "https://external-preview.redd.it/poster.png?width=1280&amp;s=sig", width: 1280, height: 720 }, resolutions: [] }],
		},
	};

	test("load images through reddont but keep the media page's link", () => {
		for (const html of [
			renderPost(imagePost, "compact", "test", proxied),
			renderPost(imagePost, "card", "test", proxied),
			renderPostPage(imagePost, proxied),
		]) {
			expect(html).toContain('src="/proxy/i.redd.it/example.png"');
			expect(html).toContain('href="/media/https://i.redd.it/example.png"');
			expect(html).not.toMatch(directMedia);
		}
		expect(renderPostPage(imagePost, proxied)).toContain('src="/proxy/preview.redd.it/example.png?width=640&amp;s=small"');
		// Off, the same pages still load from Reddit.
		expect(renderPost(imagePost, "card", "test")).toMatch(directMedia);
		expect(renderPostPage(videoPost)).toMatch(directMedia);
	});

	test("load hosted video, its manifests and its poster through reddont", () => {
		for (const html of [renderPost(videoPost, "card", "test", proxied), renderPostPage(videoPost, proxied)]) {
			expect(html).toContain('data-dash-url="/proxy/v.redd.it/clip/DASHPlaylist.mpd?a=1&amp;v=1"');
			expect(html).toContain('data-hls-url="/proxy/v.redd.it/clip/HLSPlaylist.m3u8?a=1&amp;v=1"');
			expect(html).toContain('data-fallback-url="/proxy/v.redd.it/clip/DASH_720.mp4?source=fallback"');
			expect(html).toContain('poster="/proxy/external-preview.redd.it/poster.png?width=1280&amp;s=sig"');
			expect(html).not.toMatch(directMedia);
		}
	});

	test("load galleries, avatars, community icons and inline images through reddont", () => {
		const gallery = renderPost(galleryPost(), "card", "test", proxied);
		expect(gallery).toContain('src="/proxy/i.redd.it/first.png"');
		expect(gallery).toContain('src="/proxy/i.redd.it/second.jpg"');
		expect(gallery).toContain('href="/media/https://i.redd.it/first.png"');
		expect(gallery).toContain('src="/proxy/www.redditstatic.com/avatars/defaults/v2/avatar_default_');
		expect(gallery).not.toMatch(directMedia);
		expect(renderPostPage(galleryPost(), proxied)).not.toMatch(directMedia);

		const icon = "https://styles.redditmedia.com/t5_x/styles/communityIcon_abc.png?width=256&amp;s=sig";
		const mixedFeed = renderPost({ sr_detail: { community_icon: icon } }, "card", "all", proxied);
		expect(mixedFeed).toContain('src="/proxy/styles.redditmedia.com/t5_x/styles/communityIcon_abc.png?width=256&amp;s=sig"');

		const inline = "https://preview.redd.it/inline.png?width=640&amp;s=x";
		const imgur = "https://i.imgur.com/elsewhere.png";
		const text = renderPost({ selftext_html: `<p><a href="${inline}">${inline}</a> <a href="${imgur}">${imgur}</a></p>` }, "compact", "test", proxied);
		expect(text).toContain('<a href="/proxy/preview.redd.it/inline.png?width=640&amp;s=x"><img class="inline" src="/proxy/preview.redd.it/inline.png?width=640&amp;s=x"');
		expect(text).toContain(`<img class="inline" src="${imgur}"`);
	});

	test("show the full-size media page through reddont", () => {
		const image = pug.renderFile("src/views/media.pug", { kind: "img", url: "https://i.redd.it/photo.JPG", ...proxied });
		const video = pug.renderFile("src/views/media.pug", { kind: "video", url: "https://v.redd.it/clip/DASH_720.mp4", ...proxied });

		expect(image).toContain('<img class="media-maximized" src="/proxy/i.redd.it/photo.JPG"');
		expect(video).toContain('<video class="media-maximized" src="/proxy/v.redd.it/clip/DASH_720.mp4"');
	});
});

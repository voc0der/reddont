// Fictional content only. Fixed timestamps keep regenerated screenshots comparable.
const NOW = Date.parse("2026-09-20T16:00:00Z");
const MEDIA = "https://gallery.invalid";
const subscriptions = ["TrailNotes", "NightSky", "SmallProjects", "CozyCorners", "SelfHosted", "SlowSunday"];

function community(name) {
	return {
		display_name: name,
		title: "A little further from the everyday",
		public_description: "Quiet trails, big skies, and the things we make along the way.",
		description_html: '<div class="md"><h2>Take the long way home.</h2><p>A place for weekend wanderers, trail notes, and small discoveries.</p><h3>Around the campfire</h3><p>Share your route. Tell the story behind the view. Leave a little room for the unexpected.</p><hr><h3>Community notes</h3><ol><li>Be kind and curious.</li><li>Leave places better than you found them.</li><li>Give credit to the people who made it.</li></ol><hr><p><strong>This week:</strong> the first signs of autumn.</p></div>',
		subscribers: 48216,
		accounts_active: 128,
		created_utc: NOW / 1000 - 86400 * 365 * 5,
		community_icon: `${MEDIA}/community.svg`,
		banner_background_image: `${MEDIA}/lake.svg`,
		primary_color: "#487c72",
		link_flair_position: "right",
	};
}

const entries = [
	["lake", "The trail was worth the early start. Blue hour at Mirror Lake.", "TrailNotes", "northbound", "lake", 1842, 86, "Trip report"],
	["weekend", "What is one small thing you made this weekend?", "SmallProjects", "cedarandstring", null, 428, 124, "Discussion"],
	["stars", "My backyard observatory is finally ready for a clear night", "NightSky", "orbitandtea", "observatory", 967, 42, "Project"],
	["desk", "A reading corner, a rainy afternoon, and nowhere to be", "CozyCorners", "paperlantern", "desk", 731, 38, "At home"],
	["packing", "The things I stopped packing after a year of weekend hikes", "TrailNotes", "mossandmaps", null, 315, 57, "Field notes"],
	["sunrise", "No alarm, no itinerary. Just the coast at sunrise.", "SlowSunday", "tidelines", "sunrise", 1206, 63, "Outside"],
	["server", "A tiny home server that does exactly enough", "SelfHosted", "localfirst", null, 289, 92, "Build log"],
	["maps", "I started drawing a map of all my favorite local walks", "SmallProjects", "penciltrail", "lake", 562, 31, "Made by me"],
	["coffee", "The best part of a long walk is the coffee afterwards", "TrailNotes", "bootsandbeans", "desk", 204, 18, "Small joys"],
	["moon", "September sky notes: what to look for after sunset", "NightSky", "littleorbit", "observatory", 683, 47, "Guide"],
	["books", "Which book made you put your phone down this month?", "SlowSunday", "marginnotes", null, 156, 74, "Discussion"],
	["seasons", "Same trail, different season. It never gets old.", "TrailNotes", "northbound", "sunrise", 892, 29, "Trip report"],
];

const posts = entries.map(([id, title, subreddit, author, media, score, num_comments, flair], index) => {
	const image = media && `${MEDIA}/${media}.svg`;
	return { kind: "t3", data: {
		id, name: `t3_${id}`, title, subreddit, author, score, ups: score, num_comments,
		created: NOW / 1000 - (index + 1) * 3600,
		created_utc: NOW / 1000 - (index + 1) * 3600,
		permalink: `/r/${subreddit}/comments/${id}/weekend_notes/`,
		url: image || `https://www.reddit.com/r/${subreddit}/comments/${id}/weekend_notes/`,
		domain: image ? "i.redd.it" : `self.${subreddit}`,
		is_self: !image, post_hint: image ? "image" : "self",
		thumbnail: image || "self", thumbnail_width: 140, thumbnail_height: 88,
		preview: image ? { images: [{ source: { url: image, width: 1200, height: 750 }, resolutions: [] }] } : undefined,
		selftext_html: image ? "" : '<div class="md"><p>No grand plans, just a free afternoon and something I wanted to try. The result is a little imperfect, but that is part of the appeal.</p><p>What have you been working on? Share a small win, a lesson learned, or the project you are still figuring out.</p></div>',
		sr_detail: community(subreddit),
		link_flair_text: flair, link_flair_background_color: "#d7e8dd", link_flair_text_color: "dark",
		edited: false, over_18: false, spoiler: false, stickied: false, gilded: 0,
	} };
});

function comment(id, author, text, score, replies = [], extra = {}) {
	return { kind: "t1", data: {
		id, name: `t1_${id}`, author, body: text, body_html: `<div class="md"><p>${text}</p></div>`,
		ups: score, score, created: NOW / 1000 - 1800 - Number(id.slice(1)) * 300,
		permalink: `/r/SmallProjects/comments/weekend/weekend_notes/${id}/`,
		parent_id: "t3_weekend", edited: false, gilded: 0,
		replies: replies.length ? { kind: "Listing", data: { children: replies } } : "",
		...extra,
	} };
}

const comments = [
	comment("c1", "quietworkshop", "Built a little shelf from an offcut I had been saving for two years. Apparently the right project was a 30-minute one.", 186, [
		comment("c2", "cedarandstring", "The offcut collection finally pays rent! What did you use for the finish?", 72, [
			comment("c3", "quietworkshop", "Just a little beeswax. Kept the saw marks because they tell the story.", 49, [], { parent_id: "t1_c2" }),
		], { is_submitter: true, parent_id: "t1_c1" }),
		comment("c4", "paperlantern", "A shelf for the things that do not quite have a home yet. That is a good project.", 38, [], { parent_id: "t1_c1" }),
	]),
	comment("c5", "localfirst", "Moved my reading list off a cloud service and onto a tiny box on my desk. It is not much, but it feels like mine.", 124, [
		comment("c6", "littleorbit", "Small, useful, and finished. The best kind of weekend project.", 56, [], { parent_id: "t1_c5" }),
	]),
	comment("c7", "mossandmaps", "Drew a map of the walk to the bakery. It has exactly one landmark, and that landmark is a very good dog.", 98),
	comment("c8", "penciltrail", "Fixed the wobbly chair instead of starting something new. Counting it.", 83),
];

const listing = (children) => ({ kind: "Listing", data: { after: null, before: null, children } });

function responseFor(url) {
	if (url.origin !== "https://www.reddit.com") throw new Error(`Unmocked upstream origin: ${url.origin}`);
	const path = decodeURIComponent(url.pathname);
	const about = path.match(/^\/r\/([^/]+)\/about\.json$/);
	if (about) return { kind: "t5", data: community(about[1]) };
	const thread = path.match(/^\/comments\/([a-z0-9]+)\.json$/);
	if (thread) {
		const post = posts.find(({ data }) => data.id === thread[1]);
		if (!post) throw new Error(`Unknown fixture post: ${thread[1]}`);
		return [listing([post]), listing(comments)];
	}
	const feed = path.match(/^\/r\/([^/]+)\/(hot|new|top|best|rising|controversial)\.json$/);
	if (feed) {
		const names = feed[1].toLowerCase().split("+");
		return listing(names.includes("all") || names.includes("popular") ? posts : posts.filter(({ data }) => names.includes(data.subreddit.toLowerCase())));
	}
	throw new Error(`Unmocked upstream path: ${path}`);
}

module.exports = { NOW, MEDIA, subscriptions, posts, responseFor };

// Checks, live, every kind of request reddont sends Reddit with a cookie,
// through reddont's own client and with the options its routes pass. Reddit
// has been blocking these endpoints for cookie sessions one at a time (see
// src/geddit.js); this shows which ones still answer.
//
//   bun run check:reddit [cookie-file]
//
// The file holds what the dashboard accepts: a Cookie header, cookie pairs, or
// a reddit_session value. From a whole "Copy Request Headers" block, only the
// Cookie line is used. The default file, reddit-cookie.txt, is ignored by git.
// A run sends about 25 requests. Reddit allows a cookie session 100 per
// window, shared with any reddont instance that uses the same account.
import { readFileSync } from "node:fs";
import { Geddit } from "../../src/geddit.js";
import { normalizeRedditAuthInput } from "../../src/redditAuth.js";
import { MORE_COMMENTS_LIMIT, commentSort } from "../../src/utils/redditComments.js";
import { parseSearchQuery, searchRequestOptions } from "../../src/utils/redditSearch.js";

const USAGE = "Usage: bun run check:reddit [cookie-file]";
// A multi whose names aren't in their canonical case, like a home feed built
// from stored subscriptions: old reddit redirects it first.
const MULTI = "Linux+Programming";
const COMMUNITY = "europe";

class Skip extends Error {}

function readCookie(path) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		throw new Error(`Can't read ${path}. ${USAGE}`);
	}
	const line = text.split(/\r?\n/).find((entry) => /^\s*cookie\s*:/i.test(entry));
	const input = (line ?? text).trim();
	const { cookie } = normalizeRedditAuthInput(input, input.includes("=") ? "cookie" : "reddit_session");
	if (!/(?:^|;\s*)reddit_session=/.test(cookie || "")) {
		throw new Error(`${path} has no reddit_session cookie`);
	}
	return cookie;
}

// Logs every request reddont makes, with why Reddit refused it.
const requests = [];
let rateLimit = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : input);
	const response = await realFetch(input, init);
	const remaining = response.headers.get("x-ratelimit-remaining");
	if (remaining !== null) {
		rateLimit = {
			remaining: Number(remaining),
			resetAt: Date.now() + Number(response.headers.get("x-ratelimit-reset")) * 1000,
		};
	}
	requests.push({ status: response.status, url, note: await describe(response, url) });
	return response;
};

async function describe(response, url) {
	const location = response.headers.get("location");
	if (location) {
		const next = new URL(location, url);
		return `redirect to ${next.host}${next.pathname}`;
	}
	if (response.ok) return "";
	if (response.status === 429) return "rate limited";
	const body = await response.clone().text().catch(() => "");
	if (/network security/i.test(body)) return "network-security block";
	if (/whoa there/i.test(body)) return "cookie rejected";
	return "";
}

function findMore(things) {
	for (const thing of things || []) {
		if (thing?.kind === "more" && thing.data?.children?.length) return thing;
		const found = findMore(thing?.data?.replies?.data?.children);
		if (found) return found;
	}
	return null;
}

const G = new Geddit();
const state = { posts: [] };
let auth;

// The options browserListing passes for a feed page.
async function feed(sort, community, options = {}) {
	const listing = await G.getSubmissions(sort, community, { limit: 25, sr_detail: true, ...options }, auth);
	if (!listing?.posts?.length) throw new Error("no posts");
	state.posts.push(...listing.posts);
	state.after = listing.after;
	const missing = listing.posts.filter((post) => !post.data?.sr_detail).length;
	return `${listing.posts.length} posts${missing ? `, ${missing} without their community` : ""}`;
}

async function search(query) {
	const parsed = parseSearchQuery(query);
	const options = { sr_detail: true, ...searchRequestOptions(parsed) };
	const results = parsed.restrict
		? await G.searchAll(parsed.q, parsed.subreddit, options, auth)
		: await G.searchSubmissions(parsed.q, options, auth);
	if (!results?.items?.length) throw new Error("no results");
	return `${results.items.length} results`;
}

const checks = [
	["signed in", async () => {
		const response = await fetch("https://old.reddit.com/api/me.json", G.getFetchOptions(auth));
		const me = await response.json().catch(() => null);
		if (!me?.data?.name) throw new Error("Reddit doesn't accept this cookie; it may be signed out or expired");
		return "Reddit accepts the cookie";
	}],
	[`feed: r/${MULTI} hot`, () => feed("hot", MULTI)],
	["feed: next page", () => {
		if (!state.after) throw new Skip("the first page had no next page");
		return feed("hot", MULTI, { after: state.after, count: 25 });
	}],
	[`feed: r/${COMMUNITY} new`, () => feed("new", COMMUNITY)],
	["feed: r/all top, day", () => feed("top", "all", { t: "day" })],
	["feed: r/popular rising", () => feed("rising", "popular")],
	[`feed: r/${COMMUNITY} controversial, week`, () => feed("controversial", COMMUNITY, { t: "week" })],
	[`community: r/${COMMUNITY} about`, async () => {
		const about = await G.getSubreddit(COMMUNITY, auth);
		if (!about?.display_name) throw new Error("no community details");
		return `${about.subscribers} members`;
	}],
	["comments: thread", async () => {
		const post = state.posts.reduce((best, item) => (item.data.num_comments > (best?.data.num_comments ?? -1) ? item : best), null);
		if (!post) throw new Skip("no feed loaded a post");
		const thread = await G.getSubmissionComments(post.data.id, { limit: 50, sr_detail: true, sort: commentSort() }, auth);
		if (!thread?.comments?.length) throw new Error(`no comments on post ${post.data.id}`);
		state.thread = { id: post.data.id, comments: thread.comments };
		return `${thread.comments.length} top-level comments on post ${post.data.id}`;
	}],
	["comments: load more", async () => {
		if (!state.thread) throw new Skip("no thread loaded");
		const more = findMore(state.thread.comments);
		if (!more) throw new Skip("the thread has no more comments to load");
		const children = more.data.children.slice(0, MORE_COMMENTS_LIMIT);
		const things = await G.getMoreComments(state.thread.id, children, commentSort(), auth);
		if (!things?.length) throw new Error("no comments");
		return `${things.length} comments for ${children.length} requested`;
	}],
	["comments: single comment thread", async () => {
		const comment = state.thread?.comments.find((thing) => thing.kind === "t1");
		if (!comment) throw new Skip("no comment loaded");
		const thread = await G.getSingleCommentThread(state.thread.id, comment.data.id, { limit: 50, sort: commentSort() }, auth);
		if (!thread?.comments?.length) {
			// Reddit answers 404 for some comments with 13-character IDs.
			throw new Error(`no thread for comment ${comment.data.id}`);
		}
		return `comment ${comment.data.id}`;
	}],
	["search: posts", () => search({ q: "linux" })],
	[`search: posts in r/${COMMUNITY}`, () => search({ q: "bike", sr: COMMUNITY, restrict_sr: "on" })],
	["search: communities", async () => {
		const results = await G.searchSubreddits("linux", { limit: 3, include_over_18: false }, auth);
		if (!results?.items?.length) throw new Error("no results");
		return `${results.items.length} results`;
	}],
];

const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith("-")) {
	console.error(USAGE);
	process.exit(2);
}
const cookieFile = args[0] || "reddit-cookie.txt";
try {
	const cookie = readCookie(cookieFile);
	auth = { authHeaders: { cookie } };
	console.log(`Cookies from ${cookieFile}: ${cookie.split(/;\s*/).map((pair) => pair.split("=")[0]).join(" ")}`);
} catch (error) {
	console.error(error.message);
	process.exit(2);
}

const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
for (const [name, check] of checks) {
	const first = requests.length;
	let outcome;
	let detail;
	try {
		detail = await check();
		outcome = "PASS";
	} catch (error) {
		outcome = error instanceof Skip ? "SKIP" : "FAIL";
		detail = error.message;
	}
	counts[outcome]++;
	console.log(`${outcome} ${name}: ${detail}`);
	const sent = requests.slice(first);
	for (const { status, url, note } of sent) {
		console.log(`       ${status} ${url.host}${url.pathname}${note ? ` (${note})` : ""}`);
	}
	if (outcome === "FAIL" && name === "signed in") break;
	if (sent.some(({ status }) => status === 429)) {
		console.log("Stopped: Reddit is rate limiting this session.");
		break;
	}
}

let summary = `${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped, ${requests.length} requests`;
if (rateLimit) {
	const resetIn = Math.max(0, Math.round((rateLimit.resetAt - Date.now()) / 1000));
	summary += `; ${rateLimit.remaining} left in this window, which resets in ${resetIn} s`;
}
console.log(summary);
process.exit(counts.FAIL ? 1 : 0);

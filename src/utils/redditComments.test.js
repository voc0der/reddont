const { afterEach, describe, expect, test } = require("bun:test");
const { Geddit } = require("../geddit");
const { expandMoreComments } = require("./redditComments");

const comment = (id, parent_id = "t3_post1") => ({ kind: "t1", data: { id, parent_id, replies: "" } });
const more = (children, parent_id = "t3_post1", count = children.length) => ({
	kind: "more", data: { id: children[0] || "_", parent_id, children, count },
});
const expand = (things, children, count = children.length) => expandMoreComments(things, { children, count, parentId: "t3_post1" });

describe("more comment batches", () => {
	test("loads sibling comments and rebuilds descendants even when they arrive first", () => {
		const result = expand([
			comment("grandchild", "t1_reply"), comment("reply", "t1_first"),
			comment("first"), comment("second"), more(["hidden"], "t1_second"),
		], ["first", "second"]);
		expect(result.map((node) => node.data.id)).toEqual(["first", "second"]);
		expect(result[0].data.replies.data.children[0].data.replies.data.children[0].data.id).toBe("grandchild");
		expect(result[1].data.replies.data.children[0].data.children).toEqual(["hidden"]);
	});

	test("retains thousands of unrequested comments across successive batches", () => {
		let ids = Array.from({ length: 3548 }, (_, i) => `c${i}`);
		const loaded = [];
		while (ids.length) {
			const batch = expand(ids.slice(0, 100).map((id) => comment(id)), ids);
			loaded.push(...batch.filter((node) => node.kind === "t1").map((node) => node.data.id));
			const next = batch.find((node) => node.kind === "more");
			ids = next?.data.children || [];
			if (next) expect(next.data.count).toBe(ids.length);
		}
		expect(loaded).toHaveLength(3548);
		expect(new Set(loaded).size).toBe(3548);
	});

	test("does not request descendants or returned stubs again in the next batch", () => {
		const ids = Array.from({ length: 103 }, (_, i) => `c${i}`);
		const result = expand([
			comment("c0"), comment("c100", "t1_c0"), more(["c101"], "t1_c0", 5),
		], ids, 200);
		expect(result.at(-1).data.children).toEqual(["c102"]);
		expect(result.at(-1).data.count).toBe(193);
	});

	test("removes duplicates while retaining empty depth-limit stubs", () => {
		const result = expand([
			comment("first"), comment("first"), comment("reply", "t1_first"),
			more(["reply", "hidden"], "t1_first"), more([], "t1_reply", 0),
		], ["first"]);
		expect(result).toHaveLength(1);
		const replies = result[0].data.replies.data.children;
		expect(replies[1].data.children).toEqual(["hidden"]);
		expect(replies[0].data.replies.data.children[0].data.children).toEqual([]);
	});

	test("moves past unavailable IDs without losing the unrequested remainder", () => {
		const ids = Array.from({ length: 101 }, (_, i) => `c${i}`);
		expect(expand([], ids)[0].data.children).toEqual(["c100"]);
		expect(expand([], ["gone"])).toEqual([]);
	});
});

describe("morechildren requests", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => { globalThis.fetch = realFetch; });

	test("uses the batch endpoint with all IDs, sort, and stored credentials", async () => {
		let request;
		globalThis.fetch = async (url, options) => {
			request = { url: new URL(url), options };
			return Response.json({ json: { errors: [], data: { things: [comment("a"), comment("b")] } } });
		};
		const result = await new Geddit().getMoreComments("post1", ["a", "b"], "new", { authHeaders: { authorization: "Bearer test" } });
		expect(result).toHaveLength(2);
		expect(request.url.pathname).toBe("/api/morechildren.json");
		expect(Object.fromEntries(request.url.searchParams)).toEqual({ api_type: "json", link_id: "t3_post1", children: "a,b", sort: "new" });
		expect(request.options.headers.Authorization).toBe("Bearer test");
	});

	test("rejects invalid IDs and oversized batches before fetching", async () => {
		let calls = 0;
		globalThis.fetch = () => { calls++; throw new Error("Must not fetch"); };
		const client = new Geddit();
		expect(await client.getMoreComments("../post", ["a"])).toBeNull();
		expect(await client.getMoreComments("post1", ["a&b"])).toBeNull();
		expect(await client.getMoreComments("post1", Array(101).fill("a"))).toBeNull();
		expect(await client.getMoreComments(undefined, ["a"])).toBeNull();
		expect(await client.getMoreComments("post1", [undefined])).toBeNull();
		expect(calls).toBe(0);
	});

	test("distinguishes empty success from HTTP, API, and malformed-response failures", async () => {
		for (const response of [
			new Response("unavailable", { status: 503 }),
			Response.json({ json: { errors: [["RATELIMIT"]], data: { things: [] } } }),
			Response.json({ json: { data: {} } }),
			Response.json({ json: { data: { things: [null] } } }),
		]) {
			globalThis.fetch = async () => response;
			expect(await new Geddit().getMoreComments("post1", ["a"])).toBeNull();
		}
		globalThis.fetch = async () => Response.json({ json: { data: { things: [] } } });
		expect(await new Geddit().getMoreComments("post1", ["a"])).toEqual([]);
	});
});

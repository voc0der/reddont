const { describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");

// express.static serves src/public at the site root; comment pages load this script.
const source = fs.readFileSync(path.join(__dirname, "public", "comments.js"), "utf8");

const CONTAINER = '.comments-container[data-infinite-scroll="1"]';
const LAST_GROUP = `${CONTAINER} > form.more:last-child`;
const FOLDED_REPLIES = ".comment[data-fold] > details";
const FOCUSABLE = 'summary, button[type="submit"], a';

function expectSelector(selector, expected) {
	if (selector !== expected) throw new Error(`Unexpected selector: ${selector}`);
}

// Runs the script with stand-ins for the DOM features it uses. The page is a
// flat list of comments and "more" forms. page.html() stands in for markup the
// server renders: the fake <template> turns it back into those nodes.
function loadPage({ infiniteScroll = false, phone = false, observer = true } = {}) {
	const listeners = {};
	const fragments = new Map();
	const responses = [];
	const page = { nodes: [], requests: [], observer: null };

	page.comment = (id, { folded = false } = {}) => {
		const summary = { focus: (options) => { summary.focused = options; } };
		return { id, folded, details: { open: true }, summary, focusTarget: summary };
	};

	page.moreForm = (id) => {
		const button = { disabled: false };
		const status = { textContent: "" };
		const form = {
			id,
			action: `https://reddont.test/comments/abc/more?group=${id}`,
			fields: { children: `${id}1,${id}2`, sort: "top" },
			dataset: {},
			attributes: {},
			button,
			status,
			focusTarget: button,
			get isConnected() {
				return page.nodes.includes(form);
			},
			matches: (selector) => selector === "form.more",
			querySelector: (selector) => ({ 'button[type="submit"]': button, ".more-status": status })[selector],
			setAttribute: (name, value) => { form.attributes[name] = value; },
			removeAttribute: (name) => { delete form.attributes[name]; },
			contains: (node) => [form, button, status].includes(node),
			requestSubmit: () => page.submit(form),
			replaceWith: (fragment) => {
				page.nodes.splice(page.nodes.indexOf(form), 1, ...fragment.nodes);
			},
		};
		return form;
	};

	page.html = (...nodes) => {
		const html = `<!-- ${nodes.map((node) => node.id).join(" ")} -->`;
		fragments.set(html, nodes);
		return html;
	};

	// Queues fetch results: a Response, a stand-in object, or a function for
	// replies that fail or arrive later.
	page.respond = (...results) => responses.push(...results);

	page.show = (...nodes) => {
		page.nodes = nodes;
		listeners.DOMContentLoaded();
	};

	page.submit = (target) => {
		const event = { target, defaultPrevented: false, preventDefault: () => { event.defaultPrevented = true; } };
		listeners.submit(event);
		return event;
	};

	page.ids = () => page.nodes.map((node) => node.id);
	page.observed = () => [...page.observer.targets].map((node) => node.id);

	const document = {
		activeElement: null,
		addEventListener: (type, listener) => { listeners[type] = listener; },
		querySelector: (selector) => {
			expectSelector(selector, CONTAINER);
			return infiniteScroll ? {} : null;
		},
		querySelectorAll: (selector) => {
			expectSelector(selector, LAST_GROUP);
			const last = page.nodes.at(-1);
			return infiniteScroll && last?.matches ? [last] : [];
		},
		createElement: (tag) => {
			if (tag !== "template") throw new Error(`Unexpected element: ${tag}`);
			const template = {};
			Object.defineProperty(template, "innerHTML", {
				set(html) {
					const nodes = fragments.get(html);
					template.content = {
						nodes,
						querySelectorAll: (selector) => {
							expectSelector(selector, FOLDED_REPLIES);
							return nodes.filter((node) => node.folded).map((node) => node.details);
						},
						querySelector: (selector) => {
							expectSelector(selector, FOCUSABLE);
							return nodes[0]?.focusTarget ?? null;
						},
					};
				},
			});
			return template;
		},
	};
	page.document = document;

	class IntersectionObserver {
		constructor(callback, options) {
			this.callback = callback;
			this.options = options;
			this.targets = new Set();
			page.observer = this;
		}

		observe(target) {
			this.targets.add(target);
		}

		unobserve(target) {
			this.targets.delete(target);
		}

		disconnect() {
			this.targets.clear();
		}

		report(...entries) {
			this.callback(entries);
		}
	}

	class FormData {
		constructor(form) {
			this.fields = Object.entries(form.fields);
		}

		[Symbol.iterator]() {
			return this.fields[Symbol.iterator]();
		}
	}

	const window = {
		matchMedia: (query) => ({ matches: phone && query === "(max-width: 767px)" }),
		...(observer && { IntersectionObserver }),
	};
	const fetch = async (url, init) => {
		page.requests.push({ url, method: init.method, headers: init.headers, body: String(init.body) });
		const result = responses.shift();
		return typeof result === "function" ? result() : result;
	};
	new Function("document", "window", "IntersectionObserver", "FormData", "fetch", source)(
		document, window, window.IntersectionObserver, FormData, fetch,
	);
	return page;
}

// Lets a queued load finish: everything after the fetch runs in microtasks.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("loading more comments", () => {
	test("posts the group's fields and puts the returned comments in its place", async () => {
		const page = loadPage();
		const group = page.moreForm("more");
		page.show(page.comment("first"), group);
		page.respond(Response.json({ html: page.html(page.comment("c1"), page.comment("c2")) }));

		const submit = page.submit(group);
		expect(submit.defaultPrevented).toBe(true);
		expect(group.button.disabled).toBe(true);
		expect(group.attributes).toEqual({ "aria-busy": "true" });
		expect(group.status.textContent).toBe(" Loading…");
		await settled();

		expect(page.requests).toEqual([{
			url: "https://reddont.test/comments/abc/more?group=more",
			method: "POST",
			headers: { Accept: "application/json" },
			body: "children=more1%2Cmore2&sort=top",
		}]);
		expect(page.ids()).toEqual(["first", "c1", "c2"]);
		expect(group.dataset).toEqual({});
		expect(group.attributes).toEqual({});
		expect(group.button.disabled).toBe(false);
	});

	test("leaves other forms to the browser", () => {
		const page = loadPage();
		const search = { matches: (selector) => selector === "form.search" };

		expect(page.submit(search).defaultPrevented).toBe(false);
		expect(page.requests).toEqual([]);
	});

	test("ignores repeat submits and loads one group at a time", async () => {
		const page = loadPage();
		const first = page.moreForm("first");
		const second = page.moreForm("second");
		page.show(first, second);
		const firstReply = Promise.withResolvers();
		page.respond(() => firstReply.promise, Response.json({ html: page.html(page.comment("from-second")) }));

		page.submit(first);
		page.submit(first);
		page.submit(second);
		await settled();
		expect(page.requests.map((request) => request.url)).toEqual([first.action]);
		expect(second.status.textContent).toBe(" Loading…");

		firstReply.resolve(Response.json({ html: page.html(page.comment("from-first")) }));
		await settled();
		expect(page.requests.map((request) => request.url)).toEqual([first.action, second.action]);
		expect(page.ids()).toEqual(["from-first", "from-second"]);
	});

	test("keeps a group that fails to load for a manual retry", async () => {
		const page = loadPage();
		const group = page.moreForm("more");
		page.show(group);

		for (const failure of [
			new Response("Unavailable", { status: 502 }),
			// An expired session redirects the request to the login page.
			{ ok: true, redirected: true },
			Response.json({ error: "missing html" }),
			() => {
				throw new TypeError("Failed to fetch");
			},
		]) {
			page.respond(failure);
			page.submit(group);
			await settled();

			expect(page.ids()).toEqual(["more"]);
			expect(group.status.textContent).toBe(" Could not load comments. Try again.");
			expect(group.dataset).toEqual({ autoFailed: "1" });
			expect(group.attributes).toEqual({});
			expect(group.button.disabled).toBe(false);
		}

		page.respond(Response.json({ html: page.html(page.comment("loaded")) }));
		page.submit(group);
		await settled();
		expect(page.ids()).toEqual(["loaded"]);
	});

	test("folds marked replies on phones only", async () => {
		for (const phone of [true, false]) {
			const page = loadPage({ phone });
			const group = page.moreForm("more");
			page.show(group);
			const folded = page.comment("folded", { folded: true });
			const open = page.comment("open");
			page.respond(Response.json({ html: page.html(folded, open) }));

			page.submit(group);
			await settled();
			expect(folded.details.open).toBe(!phone);
			expect(open.details.open).toBe(true);
		}
	});

	test("moves focus into the new comments only when the group had it", async () => {
		for (const hadFocus of [true, false]) {
			const page = loadPage();
			const elsewhere = page.comment("elsewhere");
			const group = page.moreForm("more");
			page.show(elsewhere, group);
			page.document.activeElement = hadFocus ? group.button : elsewhere.summary;
			const reply = page.comment("reply");
			page.respond(Response.json({ html: page.html(reply) }));

			page.submit(group);
			await settled();
			expect(reply.summary.focused).toEqual(hadFocus ? { preventScroll: true } : undefined);
		}
	});
});

describe("infinite scroll", () => {
	test("loads the last top-level group as it nears the screen", async () => {
		const page = loadPage({ infiniteScroll: true });
		const middle = page.moreForm("middle");
		const last = page.moreForm("last");
		page.show(middle, page.comment("comment"), last);
		expect(page.observer.options).toEqual({ rootMargin: "200px 0px" });
		expect(page.observed()).toEqual(["last"]);

		page.respond(Response.json({ html: page.html(page.comment("loaded"), page.moreForm("next")) }));
		page.observer.report({ target: last, isIntersecting: false });
		expect(page.requests).toEqual([]);

		page.observer.report({ target: last, isIntersecting: true });
		await settled();
		expect(page.requests.map((request) => request.url)).toEqual([last.action]);
		expect(page.ids()).toEqual(["middle", "comment", "loaded", "next"]);
		expect(page.observed()).toEqual(["next"]);
	});

	test("leaves a failed automatic load and removed groups for the reader", async () => {
		const page = loadPage({ infiniteScroll: true });
		const middle = page.moreForm("middle");
		const last = page.moreForm("last");
		page.show(middle, last);
		page.respond(new Response("Unavailable", { status: 502 }), Response.json({ html: page.html(page.comment("loaded")) }));

		page.observer.report({ target: last, isIntersecting: true });
		await settled();
		expect(last.dataset).toEqual({ autoFailed: "1" });

		// Loading another group checks the page again but skips the failed one.
		page.submit(middle);
		await settled();
		expect(page.ids()).toEqual(["loaded", "last"]);
		expect(page.observed()).toEqual([]);

		page.observer.report({ target: middle, isIntersecting: true });
		expect(page.requests).toHaveLength(2);
	});

	test("waits for the reader without the setting or browser support", () => {
		for (const options of [{ infiniteScroll: false }, { infiniteScroll: true, observer: false }]) {
			const page = loadPage(options);
			page.show(page.moreForm("last"));
			expect(page.observer).toBeNull();
		}
	});
});

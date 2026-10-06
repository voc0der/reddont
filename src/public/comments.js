// The upstream endpoint permits one expansion at a time. Queue clicks on
// different groups, and ignore repeat clicks while a group is loading.
let moreCommentsQueue = Promise.resolve();
let moreCommentsObserver;

// Delegation also covers forms inserted by subsequent comment batches.
document.addEventListener("submit", (event) => {
	const form = event.target;
	if (form.matches("form.more")) loadMoreComments(event, form);
});

function observeMoreComments() {
	if (!moreCommentsObserver) return;
	moreCommentsObserver.disconnect();
	// Only the final group at the page level continues the discussion. Nested
	// reply groups and depth-limit links remain under the reader's control.
	document.querySelectorAll('.comments-container[data-infinite-scroll="1"] > form.more:last-child').forEach((form) => {
		if (!form.dataset.autoFailed) moreCommentsObserver.observe(form);
	});
}

document.addEventListener("DOMContentLoaded", () => {
	if (!("IntersectionObserver" in window) || !document.querySelector('.comments-container[data-infinite-scroll="1"]')) return;
	moreCommentsObserver = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			moreCommentsObserver.unobserve(entry.target);
			if (entry.target.isConnected) entry.target.requestSubmit();
		}
	}, { rootMargin: "200px 0px" });
	observeMoreComments();
});

function loadMoreComments(event, form) {
	event.preventDefault();
	if (form.dataset.loading) return;
	form.dataset.loading = "1";
	const button = form.querySelector('button[type="submit"]');
	const status = form.querySelector(".more-status");
	button.disabled = true;
	form.setAttribute("aria-busy", "true");
	status.textContent = " Loading…";

	moreCommentsQueue = moreCommentsQueue.then(async () => {
		try {
			const response = await fetch(form.action, {
				method: "POST",
				headers: { Accept: "application/json" },
				body: new URLSearchParams(new FormData(form)),
			});
			if (!response.ok || response.redirected) throw new Error("Unable to load comments");
			const { html } = await response.json();
			if (typeof html !== "string") throw new Error("Invalid comments response");
			const template = document.createElement("template");
			template.innerHTML = html;
			if (window.matchMedia('(max-width: 767px)').matches) {
				template.content.querySelectorAll('.comment[data-fold] > details').forEach((details) => {
					details.open = false;
				});
			}
			const first = template.content.querySelector('summary, button[type="submit"], a');
			const hadFocus = form.contains(document.activeElement);
			form.replaceWith(template.content);
			if (hadFocus && first) first.focus({ preventScroll: true });
			observeMoreComments();
		} catch (_error) {
			// Leave a failed automatic load available for a manual retry without
			// repeatedly requesting it while the reader stays at the bottom.
			form.dataset.autoFailed = "1";
			status.textContent = " Could not load comments. Try again.";
		} finally {
			delete form.dataset.loading;
			form.removeAttribute("aria-busy");
			button.disabled = false;
		}
	});
}

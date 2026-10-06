const MORE_COMMENTS_LIMIT = 100;
const COMMENT_SORTS = new Set([
	"confidence", "top", "new", "controversial", "old", "random", "qa", "live",
]);

function commentSort(sort) {
	return COMMENT_SORTS.has(sort) ? sort : "confidence";
}

// morechildren returns a flat list, with parents not necessarily before replies.
// Rebuild it before rendering, and keep every unrequested ID for the next batch.
function expandMoreComments(things, { children, parentId, count }) {
	const comments = new Map();
	const nodes = [];
	function collect(items) {
		for (const thing of items) {
			if (thing.kind === "t1") {
				const name = `t1_${thing.data.id}`;
				if (comments.has(name)) continue;
				const node = { kind: "t1", data: { ...thing.data, replies: "" } };
				comments.set(name, node);
				nodes.push(node);
				collect(thing.data.replies?.data?.children || []);
			} else if (thing.kind === "more") {
				nodes.push({ kind: "more", data: { ...thing.data } });
			}
		}
	}
	collect(things);

	const roots = [];
	const covered = new Set([...comments.values()].map((node) => node.data.id));
	let hiddenCount = 0;
	for (const node of nodes) {
		if (node.kind === "more") {
			const ids = node.data.children || [];
			node.data.children = ids.filter((id) => !covered.has(id));
			if (ids.length && !node.data.children.length) continue;
			for (const id of node.data.children) covered.add(id);
			node.data.count = Math.max(
				node.data.children.length,
				(node.data.count || 0) - (ids.length - node.data.children.length),
			);
			hiddenCount += node.data.count;
		}
		const parent = comments.get(node.data.parent_id);
		if (parent && parent !== node) {
			if (!parent.data.replies) {
				parent.data.replies = { kind: "Listing", data: { children: [] } };
			}
			parent.data.replies.data.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const remaining = children.slice(MORE_COMMENTS_LIMIT).filter((id) => !covered.has(id));
	if (remaining.length) {
		roots.push({
			kind: "more",
			data: {
				id: remaining[0],
				parent_id: parentId,
				children: remaining,
				count: Math.max(remaining.length, count - comments.size - hiddenCount),
			},
		});
	}
	return roots;
}

module.exports = { MORE_COMMENTS_LIMIT, commentSort, expandMoreComments };

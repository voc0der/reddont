const { afterAll, beforeAll, beforeEach, describe, expect, test } = require("bun:test");
const { Database } = require("bun:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { startServer, withFailingWrites } = require("../test-support/server.cjs");

const secret = "isolated-user-management-secret";
const csrf = "isolated-csrf-token-for-user-management";
const token = (id) => jwt.sign({ id }, secret, { expiresIn: "1h" });
let server;
let db;
let passwordHash;

beforeAll(async () => {
	server = await startServer("users-server.cjs", "accounts-test", {
		JWT_SECRET_KEY: secret,
		REMOTE_HEADER_LOGIN: "true",
		REVERSE_PROXY_WHITELIST: "203.0.113.10",
	});
	db = new Database(path.join(server.dataDir, "reddont.db"));
	passwordHash = await Bun.password.hash("original-password");
}, 15000);

beforeEach(() => {
	for (const table of ["subscriptions", "saved_things", "invites", "users"]) db.run(`DELETE FROM ${table}`);
	const insert = db.query("INSERT INTO users (id, username, password_hash, isAdmin, apiKey) VALUES (?, ?, ?, ?, ?)");
	insert.run(1, "owner", passwordHash, 1, "reddont_owner");
	insert.run(2, "reader", passwordHash, 0, "reddont_reader");
	insert.run(3, "other", passwordHash, 0, null);
});

afterAll(async () => {
	db?.close();
	await server?.stop();
});

function account(id = 2) {
	return db.query("SELECT * FROM users WHERE id = ?").get(id);
}

function request(route, { id = 1, fields, csrfToken = csrf, headers = {}, session = token(id) } = {}) {
	return fetch(server.baseUrl + route, {
		method: fields ? "POST" : "GET",
		headers: { Cookie: [`csrf_token=${csrf}`, id && `auth_token=${session}`].filter(Boolean).join("; "), ...headers },
		body: fields ? new URLSearchParams({ _csrf: csrfToken, ...fields }) : undefined,
		redirect: "manual",
	});
}

async function whilePaused(operation, startRequest, change) {
	const pause = path.join(server.dataDir, `${operation}.pause`);
	const waiting = path.join(server.dataDir, `${operation}.waiting`);
	fs.writeFileSync(pause, "Pause the next operation");
	const pending = startRequest();
	let response;
	try {
		const deadline = Date.now() + 3000;
		while (!fs.existsSync(waiting)) {
			if (Date.now() > deadline) throw new Error(`Request never paused at ${operation}`);
			await Bun.sleep(10);
		}
		await change();
	} finally {
		fs.rmSync(pause, { force: true });
		try {
			response = await pending;
		} finally {
			fs.rmSync(waiting, { force: true });
		}
	}
	return response;
}

describe("user management", () => {
	test("only admins see Users after Invites, with edit/delete and no create", async () => {
		const html = await (await request("/dashboard")).text();
		const users = html.slice(html.indexOf('<h2 id="users">'));
		expect(html.indexOf("<h2>invites</h2>")).toBeLessThan(html.indexOf('<h2 id="users">'));
		expect(users).toContain('href="/users/2/edit"');
		expect(users).toContain('href="/users/2/delete"');
		expect(users).toContain("owner (you)");
		expect(users).not.toContain('href="/users/1/delete"');
		expect(users).not.toMatch(/create|password|reddont_reader/i);
		expect(await (await request("/dashboard", { id: 2 })).text()).not.toContain('id="users"');
	});

	test("edit and delete require a signed-in administrator, including direct posts", async () => {
		for (const action of ["edit", "delete"]) {
			for (const fields of [undefined, { username: "changed", role: "admin" }]) {
				const route = `/users/2/${action}`;
				expect((await request(route, { id: 2, fields })).status).toBe(403);
				const anonymous = await request(route, { id: null, fields });
				expect(anonymous.status).toBe(302);
				expect(anonymous.headers.get("location")).toStartWith("/login?");
			}
		}
		expect(account()).toMatchObject({ username: "reader", isAdmin: 0, password_hash: passwordHash });
	});

	test("forms contain CSRF tokens and never reveal another account's credentials", async () => {
		db.query("UPDATE users SET redditAuthHeaders = ?, oidc_refresh_token = ? WHERE id = 2").run("private-cookie", "private-refresh");
		for (const action of ["edit", "delete"]) {
			const html = await (await request(`/users/2/${action}`)).text();
			expect(html).toContain(`name="_csrf" value="${csrf}"`);
			expect(html).toContain(`action="/users/2/${action}" method="POST"`);
			for (const secret of [passwordHash, "reddont_reader", "private-cookie", "private-refresh"]) expect(html).not.toContain(secret);
			expect(html).toContain('href="/dashboard#users"');
		}
		expect(account()).not.toBeNull();
	});

	test("usernames are escaped in the list, form values, and deletion confirmation", async () => {
		const username = 'reader"><img src=x onerror=alert(1)>';
		expect((await request("/users/2/edit", { fields: { username, role: "user" } })).status).toBe(302);
		expect(account().username).toBe(username);
		for (const route of ["/dashboard", "/users/2/edit", "/users/2/delete"]) {
			const html = await (await request(route)).text();
			expect(html).not.toContain(username);
			expect(html).not.toContain("<img src=x");
			expect(html).toContain("reader&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
		}
	});

	test("renaming yourself preserves an existing session and API key", async () => {
		const session = jwt.sign({ id: 1, username: "owner" }, secret, { expiresIn: "1h" });
		const response = await request("/users/1/edit", { session, fields: { username: "renamed-owner", role: "admin" } });
		expect(response.status).toBe(302);
		const dashboard = await (await request("/dashboard", { session })).text();
		expect(dashboard).toContain("renamed-owner (you)");
		expect((await request("/users/2/edit", { session })).status).toBe(200);
		const api = await fetch(`${server.baseUrl}/api/v1/whoami`, { headers: { "X-API-Key": "reddont_owner" } });
		expect(api.status).toBe(200);
		expect(await api.json()).toMatchObject({ username: "renamed-owner", isAdmin: true });
	});

	test("renames and promotes an account while preserving a blank password and preferences", async () => {
		db.query("UPDATE users SET themePreference = 'dark', oidc_sub = 'linked-identity' WHERE id = 2").run();
		const response = await request("/users/2/edit", { fields: { username: " renamed ", role: "admin", password: "", confirm_password: "" } });
		expect(response.headers.get("location")).toBe("/dashboard?message=user-updated#users");
		expect(account()).toMatchObject({ username: "renamed", isAdmin: 1, password_hash: passwordHash, themePreference: "dark", oidc_sub: "linked-identity", apiKey: "reddont_reader" });
		expect((await request("/users/3/edit", { id: 2 })).status).toBe(200);
		const login = await request("/login", { id: null, fields: { username: "renamed", password: "original-password" } });
		expect(login.headers.get("location")).toBe("/");
	});

	test("resets a local password and accepts only the new password on login", async () => {
		const fields = { username: "reader", role: "user", password: "replacement-password", confirm_password: "replacement-password" };
		expect((await request("/users/2/edit", { fields })).status).toBe(302);
		expect(await Bun.password.verify(fields.password, account().password_hash)).toBe(true);
		const oldLogin = await request("/login", { id: null, fields: { username: "reader", password: "original-password" } });
		expect(await oldLogin.text()).toContain("Invalid credentials");
		const newLogin = await request("/login", { id: null, fields: { username: "reader", password: fields.password } });
		expect(newLogin.headers.get("location")).toBe("/");
	});

	test("rejects invalid names, roles, and password confirmations without partial changes", async () => {
		for (const [changes, status] of [
			[{ username: " " }, 400],
			[{ username: "owner" }, 409],
			[{ role: "invalid" }, 400],
			[{ password: "different", confirm_password: "mismatch" }, 400],
			[{ password: "", confirm_password: "unexpected" }, 400],
			[{ "username[]": "nested", username: "reader" }, 400],
			[{ "role[]": "admin" }, 400],
			[{ "password[]": "replacement", confirm_password: "replacement" }, 400],
			[{ password: "replacement", "confirm_password[]": "replacement" }, 400],
		]) {
			const fields = { username: "reader", role: "admin", ...changes };
			expect((await request("/users/2/edit", { fields })).status).toBe(status);
			expect(account()).toMatchObject({ username: "reader", isAdmin: 0, password_hash: passwordHash });
		}
	});

	test("missing required fields and nested form values cannot edit an account", async () => {
		const before = account();
		for (const fields of [{}, { username: "reader" }, { role: "admin" }, { "username[name]": "changed", role: "admin" }]) {
			expect((await request("/users/2/edit", { fields })).status).toBe(400);
			expect(account()).toEqual(before);
		}
	});

	test("protects the last administrator and self-deletion, but permits demotion with another admin", async () => {
		const fields = { username: "owner", role: "user" };
		const refused = await request("/users/1/edit", { fields });
		expect(refused.status).toBe(409);
		expect(await refused.text()).toContain("Keep at least one administrator.");
		for (const fields of [undefined, {}]) expect((await request("/users/1/delete", { fields })).status).toBe(409);
		expect(account(1).isAdmin).toBe(1);
		db.query("UPDATE users SET isAdmin = 1 WHERE id = 2").run();
		expect((await request("/users/1/edit", { fields })).status).toBe(302);
		expect(account(1).isAdmin).toBe(0);
		expect((await request("/users/2/edit")).status).toBe(403);
	});

	test.each(["demoted", "deleted"])("a password reset is refused if the editor is %s while hashing", async (change) => {
		db.query("UPDATE users SET isAdmin = 1 WHERE id = 3").run();
		const before = account();
		const response = await whilePaused("password", () => request("/users/2/edit", {
			fields: { username: "changed", role: "admin", password: "replacement", confirm_password: "replacement" },
		}), async () => {
			const route = change === "demoted" ? "/users/1/edit" : "/users/1/delete";
			const fields = change === "demoted" ? { username: "owner", role: "user" } : {};
			expect((await request(route, { id: 3, fields })).status).toBe(302);
		});
		expect(response.status).toBe(403);
		expect(await response.text()).toContain("Only admins can access this route.");
		expect(account()).toEqual(before);
	});

	test("a target deleted during password hashing is not recreated or confused with a reused username", async () => {
		const response = await whilePaused("password", () => request("/users/2/edit", {
			fields: { username: "changed", role: "admin", password: "replacement", confirm_password: "replacement" },
		}), async () => {
			expect((await request("/users/2/delete", { fields: {} })).status).toBe(302);
			expect((await request("/users/3/edit", { fields: { username: "reader", role: "user" } })).status).toBe(302);
		});
		expect(response.status).toBe(404);
		expect(await response.text()).toContain("User not found.");
		expect(account()).toBeNull();
		expect(account(3)).toMatchObject({ username: "reader", isAdmin: 0, password_hash: passwordHash });
	});

	test("a username claimed during hashing rejects the entire pending edit", async () => {
		const before = account();
		const response = await whilePaused("password", () => request("/users/2/edit", {
			fields: { username: "claimed", role: "admin", password: "replacement", confirm_password: "replacement" },
		}), async () => {
			expect((await request("/users/3/edit", { fields: { username: "claimed", role: "user" } })).status).toBe(302);
		});
		expect(response.status).toBe(409);
		expect(await response.text()).toContain("That username is already in use.");
		expect(account()).toEqual(before);
		expect(account(3).username).toBe("claimed");
	});

	test("overlapping self-demotions leave one administrator", async () => {
		db.query("UPDATE users SET isAdmin = 1 WHERE id = 3").run();
		const before = account(1);
		const response = await whilePaused("password", () => request("/users/1/edit", {
			fields: { username: "owner", role: "user", password: "replacement", confirm_password: "replacement" },
		}), async () => {
			expect((await request("/users/3/edit", { id: 3, fields: { username: "other", role: "user" } })).status).toBe(302);
		});
		expect(response.status).toBe(409);
		expect(await response.text()).toContain("Keep at least one administrator.");
		expect(account(1)).toEqual(before);
		expect(account(3).isAdmin).toBe(0);
	});

	test.each(["demoted", "deleted"])("a pending deletion is refused if the editor is %s during SSO refresh", async (change) => {
		db.query("UPDATE users SET isAdmin = 1 WHERE id = 3").run();
		db.query("UPDATE users SET oidc_sub = 'owner-sso', oidc_token_expires_at = 1 WHERE id = 1").run();
		seedRelatedData();
		const before = account();
		const response = await whilePaused("refresh", () => request("/users/2/delete", { fields: {} }), async () => {
			const route = change === "demoted" ? "/users/1/edit" : "/users/1/delete";
			const fields = change === "demoted" ? { username: "owner", role: "user" } : {};
			expect((await request(route, { id: 3, fields })).status).toBe(302);
		});
		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Only admins can access this route.");
		expect(account()).toEqual(before);
		for (const table of ["subscriptions", "saved_things", "invites"]) {
			expect(db.query(`SELECT COUNT(*) AS count FROM ${table}`).get().count).toBe(2);
		}
	});

	test("proxy groups revoke user-management access and untrusted headers cannot restore it", async () => {
		const before = account();
		for (const action of ["edit", "delete"]) {
			const fields = { username: "changed", role: "admin" };
			const denied = await request(`/users/2/${action}`, { fields, headers: { "Remote-Groups": "readers" } });
			expect(denied.status).toBe(403);
			expect(account(1).isAdmin).toBe(0);
			const forged = await request(`/users/2/${action}`, {
				fields, headers: { "Remote-Groups": "admin", "X-Test-Peer": "198.51.100.7" },
			});
			expect(forged.status).toBe(403);
			expect(account()).toEqual(before);
		}
	});

	test("unknown and malformed IDs cannot change an account", async () => {
		for (const id of ["999", "0", "2abc", "2.0", "-2"]) {
			for (const action of ["edit", "delete"]) {
				for (const fields of [undefined, { username: "changed", role: "admin" }]) {
					expect((await request(`/users/${id}/${action}`, { fields })).status).toBe(404);
				}
			}
		}
		expect(account().username).toBe("reader");
	});

	test("both mutations require a valid CSRF token", async () => {
		for (const action of ["edit", "delete"]) {
			const response = await request(`/users/2/${action}`, { csrfToken: "wrong", fields: { username: "changed", role: "admin" } });
			expect(response.status).toBe(403);
		}
		expect(account()).toMatchObject({ username: "reader", isAdmin: 0 });
	});

	function seedRelatedData() {
		for (const id of [2, 3]) {
			db.query("INSERT INTO subscriptions (user_id, subreddit) VALUES (?, 'test')").run(id);
			db.query("INSERT INTO saved_things (user_id, fullname, saved_at) VALUES (?, 't3_test', 1)").run(id);
			db.query("INSERT INTO invites (token, createdBy) VALUES (?, ?)").run(`invite-${id}`, id);
		}
	}

	test("confirmed deletion cleans up only that account and invalidates its session and API key", async () => {
		seedRelatedData();
		expect((await request("/users/2/delete")).status).toBe(200);
		expect(account()).not.toBeNull();
		const response = await request("/users/2/delete", { fields: {} });
		expect(response.headers.get("location")).toBe("/dashboard?message=user-deleted#users");
		expect(account()).toBeNull();
		for (const table of ["subscriptions", "saved_things"]) {
			expect(db.query(`SELECT user_id FROM ${table}`).all()).toEqual([{ user_id: 3 }]);
		}
		expect(db.query("SELECT createdBy FROM invites").all()).toEqual([{ createdBy: 3 }]);
		expect((await request("/dashboard", { id: 2 })).headers.get("location")).toStartWith("/login?");
		const api = await fetch(`${server.baseUrl}/api/v1/whoami`, { headers: { "X-API-Key": "reddont_reader" } });
		expect(api.status).toBe(401);
		expect(account(3)).not.toBeNull();
	});

	test.each(["subscriptions", "saved_things", "invites", "users"])("a failed deletion from %s rolls back all related data", async (table) => {
		seedRelatedData();
		db.query("UPDATE invites SET usedAt = '2026-01-01 00:00:00' WHERE createdBy = 2").run();
		const snapshot = () => Object.fromEntries(["subscriptions", "saved_things", "invites", "users"].map((name) => [
			name, db.query(`SELECT * FROM ${name} ORDER BY id`).all(),
		]));
		const before = snapshot();
		await withFailingWrites(server.dataDir, "DELETE", table, async () => {
			const response = await request("/users/2/delete", { fields: {} });
			expect(response.headers.get("location")).toBe("/dashboard?message=user-delete-failed#users");
		});
		expect(snapshot()).toEqual(before);
		expect((await request("/dashboard", { id: 2 })).status).toBe(200);
		const api = await fetch(`${server.baseUrl}/api/v1/whoami`, { headers: { "X-API-Key": "reddont_reader" } });
		expect(api.status).toBe(200);
	});

	test("a failed update reports the error and preserves the account", async () => {
		const before = account();
		await withFailingWrites(server.dataDir, "UPDATE", "users", async () => {
			const response = await request("/users/2/edit", {
				fields: { username: "changed", role: "admin", password: "replacement", confirm_password: "replacement" },
			});
			expect(response.status).toBe(500);
			expect(await response.text()).toContain("Failed to update user. Try again.");
		});
		expect(account()).toEqual(before);
	});
});

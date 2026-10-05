const { describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const pug = require("pug");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// express.static serves src/public at the site root.
function publicFile(href) {
	return path.join(__dirname, "public", href);
}

// "WIDTHxHEIGHT" from a PNG's IHDR chunk, or null when the file is not a PNG.
function pngSize(file) {
	const bytes = fs.readFileSync(file);
	if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
	return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("app icons", () => {
	test("the manifest lists PNG icons that exist at their stated sizes", () => {
		const manifest = JSON.parse(fs.readFileSync(publicFile("/manifest.json"), "utf8"));

		for (const icon of manifest.icons) {
			expect(icon.type).toBe("image/png");
			expect(pngSize(publicFile(icon.src))).toBe(icon.sizes);
		}
		expect(manifest.icons.map((icon) => `${icon.purpose || "any"} ${icon.sizes}`)).toEqual([
			"any 192x192",
			"any 512x512",
			"maskable 192x192",
			"maskable 512x512",
		]);
	});

	test("pages link a favicon and touch icon that exist", () => {
		const html = pug.renderFile(path.join(__dirname, "views/login.pug"), {
			oidcEnabled: false,
			redirect: "/",
		});
		const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]* href="([^"]+)"/g)].map(
			(match) => match[1],
		);

		expect(hrefs).toEqual(["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png"]);
		for (const href of hrefs) {
			expect(fs.existsSync(publicFile(href))).toBe(true);
		}
		expect(pngSize(publicFile("/apple-touch-icon.png"))).toBe("180x180");
	});
});

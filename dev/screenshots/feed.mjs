import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const jwt = require('jsonwebtoken');
const runDir = await mkdtemp(join(tmpdir(), 'reddont-feed-browser-'));
await writeFile(join(runDir, '.feed-test'), 'Disposable browser data');
const secret = randomBytes(32).toString('hex');
const server = spawn('bun', ['run', '--no-env-file', join(root, 'src/test-support/feed-server.cjs')], {
  cwd: root, env: { PATH: process.env.PATH, REDDONT_DATA_DIR: runDir, REDDONT_PORT: '0', HTTP_BINDING: '127.0.0.1', JWT_SECRET_KEY: secret, REDDONT_DISABLE_SSL: 'true', LOG_LEVEL: 'info', RATE_LIMIT: '1000' }, stdio: ['ignore', 'pipe', 'pipe']
});

// Scrolls to the bottom until infinite scroll has loaded the given post. On
// a tall screen the sentinel can stay in view after a page loads, so each
// pass first scrolls away from it for the observer to see it arrive again.
async function loadThrough(page, id) {
  while (!(await page.locator(`#${id}`).count())) {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight - 3 * innerHeight, behavior: 'instant' }));
    await page.waitForTimeout(50);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(150);
  }
}

// Puts a post at the given distance from the top of the viewport, then
// waits for any page that brings into view to finish loading.
async function place(page, id, offset) {
  await page.evaluate(([id, offset]) => {
    const post = document.getElementById(id).closest('article');
    window.scrollTo({ top: post.getBoundingClientRect().top + window.scrollY - offset, behavior: 'instant' });
  }, [id, offset]);
  await page.waitForTimeout(200);
  await page.waitForFunction(() => document.getElementById('loading-indicator')?.style.display !== 'block');
}

function feedState(page, id) {
  return page.evaluate((id) => {
    const ids = [...document.querySelectorAll('#posts-container article.post details[id]')].map((details) => details.id);
    const post = document.getElementById(id);
    return { ids, top: post ? Math.round(post.closest('article').getBoundingClientRect().top) : null, scrollY: window.scrollY, sentinel: !!document.getElementById('infinite-scroll-sentinel') };
  }, id);
}

async function openPost(page, id) {
  await page.locator('article.post', { has: page.locator(`#${id}`) }).locator('.title-container > a').click();
  await page.waitForURL(new RegExp(`/comments/${id}\\?`));
}

async function back(page) {
  await page.goBack({ waitUntil: 'load' });
  // Give any late browser scroll restoration the chance to move the page.
  await page.waitForTimeout(300);
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `p${from + i}`);

let browser;
try {
  const base = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(log)), 15000);
    const read = (chunk) => { log += chunk; const match = log.match(/HTTP server started on port (\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } };
    server.stdout.on('data', read); server.stderr.on('data', read);
    server.once('error', (error) => { clearTimeout(timer); reject(error); });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Exit ${code}: ${log}`)); });
  });
  // Playwright's Chromium runs without the back/forward cache, as a phone
  // often does once it evicts the feed, so going back reloads the feed page.
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const phone of [true, false]) {
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
    await context.addCookies([{ name: 'auth_token', value: jwt.sign({ id: 1, username: 'reader_scroll' }, secret, { expiresIn: '1h' }), url: base }]);
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const cursors = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/r/test/posts') cursors.push(url.searchParams.get('after'));
    });

    // Infinite scroll loads more pages, a post from a later page opens,
    // and the reader goes back. How many pages load depends on how many
    // posts fit on screen.
    await page.goto(`${base}/r/test`);
    const firstPage = (await feedState(page, 'p1')).ids;
    const inOrder = (ids) => firstPage.concat(range(Number(firstPage.at(-1).slice(1)) + 1, Number(ids.at(-1).slice(1))));
    await loadThrough(page, 'p41');
    await place(page, 'p45', 200);
    const before = await feedState(page, 'p45');
    assert.deepEqual(before.ids, inOrder(before.ids));
    const requested = cursors.length;
    await openPost(page, 'p45');
    await back(page);
    const restored = await feedState(page, 'p45');
    assert.deepEqual(restored.ids, before.ids, 'The pages loaded before must come back, not the fresh listing');
    assert.equal(restored.top, before.top, 'The opened post must return to the same height');
    assert.deepEqual(cursors.slice(requested).filter((cursor) => cursors.indexOf(cursor) < requested), [], 'Restoring must not request loaded pages again');

    // Infinite scroll continues after the restored pages without repeats.
    const next = `p${Number(before.ids.at(-1).slice(1)) + 1}`;
    await loadThrough(page, next);
    const continued = await feedState(page, next);
    assert.deepEqual(continued.ids, inOrder(continued.ids));
    assert.equal(new Set(cursors).size, cursors.length, 'Each page must be requested once');
    const fetched = Math.ceil((continued.ids.length - firstPage.length) / 25);
    const dividers = await page.locator('#posts-container .page-divider[data-page]').evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.page)));
    assert.deepEqual(dividers, Array.from({ length: fetched }, (_, i) => i + 2));

    // A later visit to the same address starts over; going back to it and
    // then to the earlier visit returns each to its own place.
    const mark = continued.ids.at(-5);
    await place(page, mark, 120);
    const leaving = await feedState(page, mark);
    await openPost(page, mark);
    await page.goto(`${base}/r/test`);
    const fresh = await feedState(page, 'p5');
    assert.equal(fresh.scrollY, 0);
    assert.deepEqual(fresh.ids.slice(1), range(1, 24), 'A new visit shows the fresh listing');
    assert.notEqual(fresh.ids[0], firstPage[0]);
    await place(page, 'p5', 300);
    const secondBefore = await feedState(page, 'p5');
    await openPost(page, 'p5');
    await back(page);
    const second = await feedState(page, 'p5');
    assert.deepEqual(second.ids, secondBefore.ids);
    assert.equal(second.top, secondBefore.top);
    await back(page);
    await back(page);
    const first = await feedState(page, mark);
    assert.deepEqual(first.ids, leaving.ids);
    assert.equal(first.top, leaving.top);

    // Once every page has loaded, going back loads nothing more.
    await loadThrough(page, 'p100');
    await page.waitForTimeout(300);
    assert.equal((await feedState(page, 'p100')).sentinel, false);
    const loadsBefore = cursors.length;
    await place(page, 'p90', 50);
    await openPost(page, 'p90');
    await back(page);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(300);
    const exhausted = await feedState(page, 'p90');
    assert.deepEqual(exhausted.ids, inOrder(['p100']));
    assert.equal(exhausted.sentinel, false);
    assert.equal(cursors.length, loadsBefore);

    // Reloading shows the fresh listing.
    await page.reload({ waitUntil: 'load' });
    const reloaded = await feedState(page, 'p1');
    assert.deepEqual(reloaded.ids.slice(1), range(1, 24));
    assert.notEqual(reloaded.ids[0], firstPage[0]);

    // Old snapshots cannot reintroduce expired posts. Snapshots from before
    // the age policy have no expiration and must also be discarded.
    for (const legacy of [false, true]) {
      await loadThrough(page, 'p45');
      await openPost(page, 'p45');
      await page.evaluate((legacy) => {
        const key = JSON.parse(sessionStorage.getItem('reddont:feeds'))[0];
        const saved = JSON.parse(sessionStorage.getItem(key));
        if (legacy) delete saved.expiresAt;
        else saved.expiresAt = Date.now() - 1;
        sessionStorage.setItem(key, JSON.stringify(saved));
      }, legacy);
      await back(page);
      const refreshed = await feedState(page, 'p1');
      assert.equal(refreshed.ids.length, 25, 'Expired snapshots reload the recent first page');
      assert.deepEqual(refreshed.ids.slice(1), range(1, 24));
    }

    // Only the most recent feeds stay in storage.
    for (let visit = 0; visit < 5; visit++) {
      await page.goto(`${base}/r/test?visit=${visit}`);
      await openPost(page, 'p1');
    }
    const saved = await page.evaluate(() => ({ keys: Object.keys(sessionStorage).filter((key) => key.startsWith('reddont:feed:')).length, index: JSON.parse(sessionStorage.getItem('reddont:feeds')).length }));
    assert.deepEqual(saved, { keys: 4, index: 4 });
    assert.deepEqual(errors, []);
    console.log(`PASS ${phone ? 'phone' : 'desktop'}: back restores loaded pages and position, scrolling resumes, visits stay separate`);
    await context.close();
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = new Promise((resolve) => server.once('exit', resolve)); server.kill(); await exited; }
  await rm(runDir, { recursive: true, force: true });
}

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
const runDir = await mkdtemp(join(tmpdir(), 'reddont-comments-browser-'));
await writeFile(join(runDir, '.comments-test'), 'Disposable browser data');
const secret = randomBytes(32).toString('hex');
const server = spawn('bun', ['run', '--no-env-file', join(root, 'src/test-support/comments-server.cjs')], {
  cwd: root, env: { PATH: process.env.PATH, REDDONT_DATA_DIR: runDir, REDDONT_PORT: '0', HTTP_BINDING: '127.0.0.1', JWT_SECRET_KEY: secret, REDDONT_DISABLE_SSL: 'true', LOG_LEVEL: 'info', RATE_LIMIT: '1000' }, stdio: ['ignore', 'pipe', 'pipe']
});
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const phone of [false, true]) {
    for (const [index, theme] of ['res', 'light', 'dark'].entries()) {
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone, colorScheme: theme === 'light' ? 'light' : 'dark', serviceWorkers: 'block' });
      const token = jwt.sign({ id: index + 1, username: `reader_${theme}` }, secret, { expiresIn: '1h' });
      await context.addCookies([{ name: 'auth_token', value: token, url: base }]);
      await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/comments/post1?sort=new`);
      await page.locator('form.more').first().waitFor();
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#c0').count(), 0, 'Disabled preference must not load automatically');
      const original = page.url();
      let active = 0, maximum = 0, requests = 0;
      await page.route('**/comments/post1/more', async (route) => {
        active++; maximum = Math.max(maximum, active); requests++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        const response = await route.fetch();
        await route.fulfill({ response });
        active--;
      });
      // Rapid clicks on two different groups must serialize, and duplicate clicks must not request twice.
      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('form.more button')];
        buttons[1].click(); buttons[1].click(); buttons[0].click();
      });
      await page.locator('#reply2').waitFor();
      await page.locator('#c99').waitFor();
      assert.equal(maximum, 1);
      assert.equal(requests, 2);
      assert.equal(page.url(), original);
      assert.equal(await page.locator('.comments-container > .comment').count(), 101);
      assert.equal(await page.locator('#existing > .comment-content > .replies > .comment').count(), 2);
      assert.equal(await page.locator('#c0 #child #grandchild').count(), 1);
      assert.equal(await page.locator('.comments-container > form.more input[name=children]').inputValue(), Array.from({ length: 105 }, (_, i) => `c${i + 100}`).join(','));
      assert.equal(await page.locator('#c0').evaluate((e) => e.closest('.comment').classList.contains('first')), true);
      assert.equal(await page.locator('#reply1').evaluate((e) => e.closest('.comment').classList.contains('alt')), true);
      assert.equal(await page.locator('.comments-container > form.more button').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (theme === 'res') {
        await page.screenshot({ path: join(runDir, `comments-${phone ? 'phone' : 'desktop'}.png`) });
      }
      // A transient failure must leave the group intact and enabled for retry.
      await page.unroute('**/comments/post1/more');
      await page.route('**/comments/post1/more', (route) => route.fulfill({ status: 502, body: 'Temporary failure' }), { times: 1 });
      await page.locator('.comments-container > form.more button').click();
      await page.getByRole('status').filter({ hasText: 'Could not load comments' }).waitFor();
      assert.equal(await page.locator('.comments-container > form.more button').isEnabled(), true);
      await page.locator('.comments-container > form.more button').click();
      await page.locator('#c199').waitFor();
      await page.locator('.comments-container > form.more button').click();
      await page.locator('#c204').waitFor();
      assert.equal(await page.locator('.comments-container > form.more').count(), 0);
      assert.equal(await page.locator('.comments-container > .comment').count(), 206);
      const ids = await page.locator('.comment > details[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(page.url(), original);
      assert.deepEqual(errors, []);
      console.log(`PASS ${phone ? 'phone' : 'desktop'} ${theme}: 205 siblings, nested replies, serialized loads, retry, no duplicate IDs`);
      await context.close();

      const autoContext = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone, colorScheme: theme === 'light' ? 'light' : 'dark', serviceWorkers: 'block' });
      await autoContext.addCookies([{ name: 'auth_token', value: jwt.sign({ id: index + 4, username: `reader_auto_${theme}` }, secret), url: base }]);
      await autoContext.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const autoPage = await autoContext.newPage();
      const autoErrors = [];
      autoPage.on('pageerror', (error) => autoErrors.push(error.message));
      let automaticRequests = 0;
      autoPage.on('request', (request) => { if (request.url().endsWith('/comments/post1/more')) automaticRequests++; });
      await autoPage.goto(`${base}/comments/post1?sort=new`);
      await autoPage.locator('#c99').waitFor();
      await autoPage.waitForTimeout(250);
      assert.equal(automaticRequests, 1, 'Load one batch while the bottom is visible');
      assert.equal(await autoPage.locator('#reply1').count(), 0, 'Nested replies must remain manual');
      await autoPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await autoPage.locator('#c199').waitFor();
      await autoPage.waitForTimeout(250);
      assert.equal(automaticRequests, 2);
      await autoPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await autoPage.locator('#c204').waitFor();
      assert.equal(automaticRequests, 3);
      assert.equal(await autoPage.locator('.comments-container > form.more').count(), 0);
      assert.equal(await autoPage.locator('.comments-container > .comment').count(), 206);
      assert.equal(await autoPage.locator('#existing form.more').count(), 1);
      const autoIds = await autoPage.locator('.comment > details[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
      assert.equal(new Set(autoIds).size, autoIds.length);
      assert.equal(autoPage.url(), `${base}/comments/post1?sort=new`);
      assert.deepEqual(autoErrors, []);
      console.log(`PASS ${phone ? 'phone' : 'desktop'} ${theme}: preference enabled, three automatic batches, nested groups stay manual`);
      await autoContext.close();
    }
  }
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  await context.addCookies([{ name: 'auth_token', value: jwt.sign({ id: 1, username: 'reader_res' }, secret), url: base }]);
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/comments/post1`);
  await page.locator('.comments-container > form.more button').click();
  await page.locator('#c99').waitFor();
  await page.locator('.comments-container > form.more button').click();
  await page.locator('#c199').waitFor();
  assert.equal(await page.locator('.comments-container > form.more input[name=children]').inputValue(), 'c200,c201,c202,c203,c204');
  console.log('PASS JavaScript disabled: form navigation and subsequent batch');
  await context.close();

  const retryContext = await browser.newContext({ serviceWorkers: 'block' });
  await retryContext.addCookies([{ name: 'auth_token', value: jwt.sign({ id: 4, username: 'reader_auto_res' }, secret), url: base }]);
  await retryContext.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const retryPage = await retryContext.newPage();
  let attempts = 0;
  await retryPage.route('**/comments/post1/more', (route) => {
    attempts++;
    return attempts === 1 ? route.fulfill({ status: 502, body: 'Temporary failure' }) : route.continue();
  });
  await retryPage.goto(`${base}/comments/post1`);
  await retryPage.getByRole('status').filter({ hasText: 'Could not load comments' }).waitFor();
  await retryPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await retryPage.waitForTimeout(500);
  assert.equal(attempts, 1, 'A failed automatic load must not retry itself');
  await retryPage.locator('.comments-container > form.more button').click();
  await retryPage.locator('#c99').waitFor();
  await retryPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await retryPage.locator('#c199').waitFor();
  assert.equal(attempts, 3, 'Manual retry must restore automatic loading for subsequent batches');
  console.log('PASS automatic error: no retry loop, manual recovery resumes infinite scrolling');
  await retryContext.close();
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = new Promise((resolve) => server.once('exit', resolve)); server.kill(); await exited; }
  await rm(runDir, { recursive: true, force: true });
}

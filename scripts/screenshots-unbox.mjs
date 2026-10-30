// Builds the app, runs it on `wrangler dev --env local` (so the five-item fixture arrives as five parcels), and at desktop and phone sizes
// cuts one parcel halfway, lets go, cuts it open, then opens the rest at once, saving a picture of each step to $UNBOX_SCREENSHOTS_DIR
// (default .local/screenshots-unbox; set UNBOX_REDUCED_MOTION=1 to run with prefers-reduced-motion). The phone run swipes with real touch events through CDP. Each size gets a fresh worker and storage.
// Run: node scripts/screenshots-unbox.mjs. Needs Playwright's Chromium (npx playwright-core install chromium); CI does not run this.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';

const viewports = [
  { size: '1440', viewport: { width: 1440, height: 900 } },
  { size: '390', viewport: { width: 390, height: 844 }, hasTouch: true },
];
const out = path.resolve(root, process.env.UNBOX_SCREENSHOTS_DIR ?? '.local/screenshots-unbox');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
build();

const box = '[data-testid="unbox-box"]', front = '[data-testid="unbox"] .unbox-hit [data-testid="unbox-box"]';
const shelfCount = page => page.evaluate(() => Number(document.querySelector('.room-canvas')?.getAttribute('data-cart-shelf')));
const waitShelf = (page, count) => page.waitForFunction(count => Number(document.querySelector('.room-canvas')?.getAttribute('data-cart-shelf')) === count, count, { timeout: 30_000 });

/** A pointer that is a mouse on desktop and a single finger (real touch events through CDP) on the phone. */
async function pointerFor(page, touch) {
  if (!touch) return { down: async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); }, move: (x, y) => page.mouse.move(x, y), up: () => page.mouse.up() };
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  return { down: (x, y) => send('touchStart', x, y), move: (x, y) => send('touchMove', x, y), up: () => send('touchEnd') };
}

/** Moves along the tape from `from` to `to` (fractions of its length) in small steps, `drift` px below its centerline. */
async function drag(pointer, tape, from, to, { first = false, drift = 0 } = {}) {
  const y = tape.y + tape.height / 2 + drift, at = fraction => tape.x + tape.width * fraction, steps = 14;
  if (first) await pointer.down(at(from), y);
  for (let i = 1; i <= steps; i++) { await pointer.move(at(from + (to - from) * i / steps), y); await new Promise(resolve => setTimeout(resolve, 12)); }
}

const browser = await launchBrowser();
const report = [];
try {
  for (const { size, viewport, hasTouch } of viewports) {
    const persistTo = fs.mkdtempSync(path.join(root, '.local', 'screenshots-unbox-'));
    const worker = await startWorker(persistTo);
    const page = await browser.newPage({ viewport, hasTouch, locale: 'zh-TW' });
    if (process.env.UNBOX_REDUCED_MOTION) await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    const shoot = async name => { await page.screenshot({ path: path.join(out, `unbox-${name}-${size}.png`) }); };
    try {
      await page.goto(worker.origin);
      await page.waitForSelector('.house-world[data-render-ready="true"][data-renderer="three-webgl"]', { timeout: 60_000 });
      await page.waitForSelector(`${front}[data-phase="atCounter"]`, { timeout: 30_000 });
      await page.waitForTimeout(1500);
      assert.equal(await page.locator(box).count(), 5, 'the five fixture items are five parcels');
      assert.equal(await shelfCount(page), 0, 'nothing is on the shelf while every item is boxed');
      await shoot('1-parcels');

      const pointer = await pointerFor(page, hasTouch);
      const tape = async () => page.locator('[data-testid="unbox-tape"]').boundingBox();

      await drag(pointer, await tape(), -0.04, 0.5, { first: true, drift: 6 });
      const half = await page.locator(front).getAttribute('data-progress');
      assert.equal(await page.locator(front).getAttribute('data-phase'), 'slicing', 'mid-swipe the parcel is being sliced');
      assert.ok(Number(half) > 0.3 && Number(half) < 0.85, `halfway progress, got ${half}`);
      await shoot('2-slicing');
      await pointer.up();
      await page.waitForSelector(`${front}[data-phase="atCounter"]`, { timeout: 5000 });
      assert.equal(await page.locator(front).getAttribute('data-progress'), null, 'lifting early drops the cut');

      await drag(pointer, await tape(), -0.04, 1.06, { first: true, drift: -8 });
      await page.waitForSelector('[data-testid="unbox-box"][data-phase="opened"]', { timeout: 5000 });
      await page.waitForTimeout(260);
      await shoot('3-opened');
      await pointer.up();
      await waitShelf(page, 1);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="unbox-box"]').length === 4, null, { timeout: 5000 });
      await page.waitForTimeout(700);
      await shoot('4-shelved');
      const stored = await (await fetch(`${worker.origin}/api/unbox`)).json();
      assert.equal(Object.keys(stored.opened).length, 1, 'the server recorded the one parcel');

      const all = page.locator('[data-testid="unbox-all"]');
      assert.match(await all.textContent(), /一鍵秒開（4 件）/);
      await all.click();
      await page.waitForTimeout(380);
      await shoot('5-open-all');
      await waitShelf(page, 5);
      await page.waitForSelector('[data-testid="unbox"]', { state: 'detached', timeout: 10_000 });
      await page.waitForTimeout(900);
      await shoot('6-all-shelved');
      assert.equal(Object.keys((await (await fetch(`${worker.origin}/api/unbox`)).json()).opened).length, 5, 'the server recorded all five');

      await page.reload();
      await page.waitForSelector('.house-world[data-render-ready="true"]', { timeout: 60_000 });
      await waitShelf(page, 5);
      assert.equal(await page.locator('[data-testid="unbox"]').count(), 0, 'nothing comes back as a parcel after a reload');
      report.push({ size, stored: Object.keys(stored.opened).length, problems });
    } finally { await page.close(); await worker.stop(); fs.rmSync(persistTo, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify(report, null, 2));
const problems = report.flatMap(entry => entry.problems);
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }

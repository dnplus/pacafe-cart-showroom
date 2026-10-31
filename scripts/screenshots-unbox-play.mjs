// Plays the unboxing extras in a real browser and saves pictures to $PLAY_SCREENSHOTS_DIR (default .local/screenshots-unbox-play), at 1440 and 390 wide:
// Muse's note card, a sticker and the album, a visitor unboxing on the share page (and what it does not touch), and a replay from the shelf.
// Uses the worker at $PLAY_ORIGIN (a fresh `wrangler dev --env local`, five-item fixture), or starts its own. Run: node scripts/screenshots-unbox-play.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';

const out = path.resolve(root, process.env.PLAY_SCREENSHOTS_DIR ?? '.local/screenshots-unbox-play');
fs.mkdirSync(out, { recursive: true });
const viewports = [{ size: '1440', viewport: { width: 1440, height: 900 } }, { size: '390', viewport: { width: 390, height: 844 }, hasTouch: true }];
const front = '[data-testid="unbox"] .unbox-hit', hit = `${front} [data-testid="unbox-box"]`;
const shelfCount = page => page.evaluate(() => Number(document.querySelector('.room-canvas')?.getAttribute('data-cart-shelf')));
const waitShelf = (page, count) => page.waitForFunction(count => Number(document.querySelector('.room-canvas')?.getAttribute('data-cart-shelf')) === count, count, { timeout: 30_000 });
const ready = page => page.waitForSelector('.house-world[data-render-ready="true"][data-renderer="three-webgl"]', { timeout: 120_000 });

/** Opens the front parcel from the keyboard and waits until what came out is on screen. */
async function openFront(page) {
  // Software rendering is slow, so what the stage showed is recorded as it appears instead of being asked for afterwards.
  await page.evaluate(() => { if (window.__seen) return; window.__seen = { notes: [], cards: [] }; new MutationObserver(() => { for (const node of document.querySelectorAll('[data-testid=unbox-note]')) window.__seen.notes.push(node.textContent); for (const node of document.querySelectorAll('[data-testid=unbox-reveal]')) window.__seen.cards.push(node.textContent); }).observe(document.body, { subtree: true, childList: true }); });
  await page.waitForSelector(`${hit}[data-phase="atCounter"]`, { timeout: 30_000 });
  await page.locator(front).focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="unbox-stage"] canvas.stage-canvas', { state: 'attached', timeout: 30_000 });
}

if (!process.env.PLAY_ORIGIN) build();
const browser = await launchBrowser(), report = [];
try {
  for (const { size, viewport, hasTouch } of viewports) {
    const persistTo = fs.mkdtempSync(path.join(root, '.local', 'screenshots-unbox-play-'));
    const worker = process.env.PLAY_ORIGIN ? { origin: process.env.PLAY_ORIGIN, stop: async () => {} } : await startWorker(persistTo);
    const problems = [], posts = [];
    const watch = page => { page.on('pageerror', error => problems.push(error.message)); page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); if (message.type() === 'warning' && !/GL Driver/.test(message.text())) console.warn('warn:', message.text().slice(0, 300)); }); page.on('request', request => { if (request.method() !== 'GET') posts.push(`${request.method()} ${new URL(request.url()).pathname}`); }); };
    const owner = await browser.newPage({ viewport, hasTouch, locale: 'en-US' });
    watch(owner);
    const shoot = (page, name) => page.screenshot({ path: path.join(out, `${name}-${size}.png`) });
    try {
      const reduced = Boolean(process.env.PLAY_REDUCED_MOTION);
      if (reduced) await owner.emulateMedia({ reducedMotion: 'reduce' });
      await owner.goto(`${worker.origin}/?lang=en`); await ready(owner);
      await owner.waitForSelector(`${hit}[data-phase="atCounter"]`, { timeout: 30_000 }); await owner.waitForTimeout(1200);
      const boxes = await owner.locator('[data-testid="unbox-box"]').evaluateAll(nodes => nodes.map(node => [node.dataset.box, node.dataset.tape, node.dataset.filler].join('/')));
      assert.ok(new Set(boxes.map(entry => entry.split('/')[0])).size >= 3, `parcels differ by store: ${boxes}`);
      await shoot(owner, '1-parcels');

      // One parcel opens in the big stage: the first is the dripper, and its card carries Muse's note.
      await openFront(owner);
      assert.match((await owner.evaluate(() => window.__seen.notes)).join(), /咖啡/, 'the note card shows Muse\'s sentence');
      await owner.waitForTimeout(reduced ? 300 : 500);
      await shoot(owner, '2-open-burst');
      await shoot(owner, '2b-note-card');
      await waitShelf(owner, 1);
      await owner.waitForSelector('[data-testid="unbox-stage"]', { state: 'detached', timeout: 30_000 });

      // Open all: a multi-pull of the other four, with two stickers (rare pulls) among them.
      await owner.waitForSelector(`${hit}[data-phase="atCounter"]`, { timeout: 30_000 });
      await owner.locator('[data-testid="unbox-all"]').click();
      await owner.waitForSelector('[data-testid="pull-cascade"]');
      await owner.waitForFunction(() => Number(document.querySelector('[data-testid="pull-cascade"]')?.dataset.opened) >= 1, null, { timeout: 12_000 });
      await owner.waitForTimeout(reduced ? 200 : 300); await shoot(owner, '3-multipull-cascade');
      // A picture takes a while in software rendering, so the second cascade frame is kept only when the cascade is still running.
      if (await owner.locator('[data-testid="pull-cascade"]').count() && Number(await owner.locator('[data-testid="pull-cascade"]').getAttribute('data-opened')) >= 2) await shoot(owner, '3b-multipull-rare');
      await owner.waitForSelector('[data-testid="pull-results"]', { timeout: 20_000 }); await owner.waitForTimeout(900);
      assert.equal(await owner.locator('[data-testid="pull-card"]').count(), 4);
      assert.equal(await owner.locator('[data-testid="pull-card"][data-rarity="rare"]').count(), 2, 'the two parcels with a sticker are rare pulls');
      await shoot(owner, '3c-multipull-results');
      await owner.locator('[data-testid="pull-card"][data-rarity="rare"]').first().click();
      await owner.waitForSelector('[data-testid="pull-zoom"] [data-testid="unbox-note"]'); await owner.waitForTimeout(900);
      await shoot(owner, '3d-multipull-card-zoom');
      await owner.locator('.pull-zoom-close').click();
      assert.equal(Object.keys((await (await fetch(`${worker.origin}/api/unbox`)).json()).opened).length, 1, 'nothing is recorded until they are put on the shelf');
      await owner.locator('[data-testid="pull-done"]').click();
      await waitShelf(owner, 5);
      await owner.waitForSelector('[data-testid="unbox-stage"]', { state: 'detached', timeout: 30_000 });
      await owner.waitForSelector('[data-testid="unbox"]', { state: 'detached', timeout: 30_000 });
      assert.equal(Object.keys((await (await fetch(`${worker.origin}/api/unbox`)).json()).opened).length, 5);

      await owner.locator('[data-testid="album-button"]').click();
      assert.equal(await owner.locator('[data-testid="album-slot"][data-found="true"]').count(), 2, 'two stickers are in the album');
      await owner.waitForTimeout(700); await shoot(owner, '4-sticker-album');
      await owner.locator('[data-testid="album-button"]').click();

      // Replay from the list row, then from a click on the shelf: no write, no change in the record.
      const before = JSON.stringify(await (await fetch(`${worker.origin}/api/unbox`)).json()); posts.length = 0;
      await owner.locator('.cart-toggle').click();
      await owner.locator('[data-testid="cart-replay"]').nth(2).click();
      await owner.waitForSelector(`${hit}[data-phase="atCounter"]`); assert.equal(await owner.locator('[data-testid="unbox"][data-replay]').count(), 1);
      await owner.locator(front).focus(); await owner.keyboard.press('Enter');
      await owner.waitForSelector('[data-testid="unbox-sticker"]'); await owner.waitForTimeout(reduced ? 300 : 1000);
      await shoot(owner, '5-shelf-replay-sticker');
      await owner.waitForSelector('[data-testid="unbox"]', { state: 'detached', timeout: 30_000 });
      await owner.evaluate(() => document.querySelector('.room-canvas').dispatchEvent(new CustomEvent('cart-product', { bubbles: true, detail: { key: document.querySelectorAll('[data-testid="cart-row"]')[0].dataset.key } })));
      await owner.waitForSelector('[data-testid="replay-offer"]'); await owner.waitForTimeout(450); await shoot(owner, '5b-replay-offer');
      await owner.locator('[data-testid="replay-go"]').click(); await owner.waitForSelector('[data-testid="unbox"][data-replay]');
      await owner.waitForSelector('[data-testid="unbox"]', { state: 'detached', timeout: 20_000 }).catch(() => {});
      assert.deepEqual(posts, [], `a replay sends nothing: ${posts}`);
      assert.equal(JSON.stringify(await (await fetch(`${worker.origin}/api/unbox`)).json()), before, 'a replay leaves the unbox record alone');
      assert.equal(await shelfCount(owner), 5);

      // A visitor on the share page.
      await fetch(`${worker.origin}/api/share`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, prices: 'range', nickname: 'Mina' }) });
      const { url } = await (await fetch(`${worker.origin}/api/share`)).json(), slug = new URL(url).pathname;
      const visitor = await browser.newPage({ viewport, hasTouch, locale: 'en-US' }); watch(visitor);
      if (reduced) await visitor.emulateMedia({ reducedMotion: 'reduce' });
      try {
        posts.length = 0; const seen = [];
        visitor.on('request', request => seen.push(new URL(request.url()).pathname));
        await visitor.goto(`${worker.origin}${slug}?lang=en`); await ready(visitor);
        await visitor.waitForSelector(`${hit}[data-phase="atCounter"]`, { timeout: 30_000 }); await visitor.waitForTimeout(1200);
        assert.equal(await visitor.locator('[data-testid="unbox-box"]').count(), 5, 'the visitor starts with five parcels');
        assert.equal(await shelfCount(visitor), 0);
        await shoot(visitor, '6-visitor-parcels');
        await openFront(visitor);
        const shown = await visitor.evaluate(() => window.__seen);
        assert.match(shown.notes.join(), /咖啡/); assert.ok(shown.cards.length && !/NT\$ 650/.test(shown.cards.join()), 'range mode shows no exact price');
        await visitor.waitForTimeout(reduced ? 300 : 600);
        await shoot(visitor, '6b-visitor-unbox');
        await waitShelf(visitor, 1); await visitor.waitForTimeout(800);
        await shoot(visitor, '6c-visitor-shelf');
        assert.equal(Object.keys((await (await fetch(`${worker.origin}/api/unbox`)).json()).opened).length, 5, 'the owner record is unchanged');
        assert.ok(!seen.some(entry => entry.startsWith('/api/unbox')), `the visitor never calls the owner endpoint: ${seen}`);
        assert.deepEqual(posts, []);
        await visitor.reload(); await ready(visitor); await waitShelf(visitor, 1);
        assert.equal(await visitor.locator('[data-testid="unbox-box"]').count(), 4, 'the visitor\'s opened parcel is remembered in this browser');
        const fresh = await browser.newPage({ viewport, hasTouch, locale: 'en-US' });
        await fresh.goto(`${worker.origin}${slug}?lang=en`); await ready(fresh);
        await fresh.waitForSelector(`${hit}[data-phase="atCounter"]`, { timeout: 30_000 });
        assert.equal(await fresh.locator('[data-testid="unbox-box"]').count(), 5, 'another visitor has their own parcels'); await fresh.close();
      } finally { await visitor.close(); }
      report.push({ size, boxes, problems });
    } finally { await owner.close(); await worker.stop(); fs.rmSync(persistTo, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify(report, null, 2));
const problems = report.flatMap(entry => entry.problems);
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }

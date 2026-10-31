// Builds the app, runs it on `wrangler dev --env local` (which seeds the five-item fixture), and saves the room at
// desktop and phone sizes to docs/screenshots once the shelf holds five products (after opening the five parcels through /api/unbox). Run: node scripts/screenshots.mjs
// Needs Playwright's Chromium (npx playwright-core install chromium) on the machine; CI does not run this.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';
import { RENDER_READY } from './lib/room.mjs';

const shots = [
  { file: 'desktop.png', viewport: { width: 1440, height: 900 } },
  { file: 'mobile-390.png', viewport: { width: 390, height: 844 }, hasTouch: true },
];
const out = path.join(root, 'docs/screenshots');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const persistTo = fs.mkdtempSync(path.join(root, '.local', 'screenshots-'));
build();
const worker = await startWorker(persistTo);
// The owner's shelf only draws unboxed items, so open the fixture's parcels first; scripts/screenshots-unbox-play.mjs shows the parcels themselves.
const { items } = await (await fetch(`${worker.origin}/api/cart`)).json();
await fetch(`${worker.origin}/api/unbox`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemIds: items.map(item => item.id) }) });
const browser = await launchBrowser();
const report = [];
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: shot.viewport, hasTouch: shot.hasTouch, locale: 'zh-TW' });
    const problems = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    await page.goto(worker.origin);
    await page.waitForSelector(RENDER_READY, { timeout: 60_000 });
    await page.waitForFunction(() => {
      const room = document.querySelector('.room-canvas');
      return room?.getAttribute('data-cart-shelf') === '5' && room.getAttribute('data-barista-source') !== 'loading' && (room.hasAttribute('data-studio-set') || room.hasAttribute('data-studio-set-error'));
    }, undefined, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, shot.file) });
    report.push({ file: `docs/screenshots/${shot.file}`, ...shot.viewport, ...await page.evaluate(() => {
      const room = document.querySelector('.room-canvas'), hud = document.querySelector('[data-testid="cart-hud"]');
      return { shelf: Number(room?.getAttribute('data-cart-shelf')), register: room?.getAttribute('data-register'), registerTag: document.querySelector('[data-testid="register-tag"]')?.textContent,
        hud: { count: hud?.querySelector('[data-testid="hud-count"]')?.textContent, total: hud?.querySelector('[data-testid="hud-total"]')?.textContent, fill: hud?.querySelector('[data-testid="hud-fill"]')?.textContent },
        barista: room?.getAttribute('data-barista-source'), studioSet: room?.getAttribute('data-studio-set') ?? `error: ${room?.getAttribute('data-studio-set-error')}` };
    }), problems });
    await page.close();
  }
} finally { await browser.close(); await worker.stop(); fs.rmSync(persistTo, { recursive: true, force: true }); }
console.log(JSON.stringify(report, null, 2));

// Opens every owner panel from the HUD, with the list shut and open, at 1440 and 390 wide, and checks the panel is in view: all of it, or as
// much as the HUD's visible height holds, without the page itself scrolling. Builds, starts its own `wrangler dev --env local`. Run: node scripts/verify-panels.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';
import { RENDER_READY } from './lib/room.mjs';

const buttons = ['clerk-button', 'share-button', 'cast-button', 'habits-button', 'album-button', 'promo-button', 'connect-button'];
build();
const persistTo = fs.mkdtempSync(path.join(root, '.local', 'verify-panels-'));
const worker = await startWorker(persistTo);
const browser = await launchBrowser(), failures = [];
try {
  const cart = await (await fetch(`${worker.origin}/api/cart`)).json();
  await fetch(`${worker.origin}/api/unbox`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemIds: cart.items.map(item => item.id) }) });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 900, locale: 'en-US' });
    await page.goto(`${worker.origin}/?lang=en`); await page.waitForSelector(RENDER_READY, { timeout: 120_000 });
    for (const listOpen of [false, true]) {
      for (const id of buttons) {
        const button = page.locator(`[data-testid="${id}"]`);
        if ((await page.locator('.cart-toggle').getAttribute('aria-expanded') === 'true') !== listOpen) await page.locator('.cart-toggle').click();
        await button.click();
        const panel = page.locator(`#${await button.getAttribute('aria-controls')}`);
        await panel.waitFor();
        const measure = node => {
          const box = node.getBoundingClientRect(), hud = document.querySelector('[data-testid="cart-hud"]').getBoundingClientRect();
          const ceiling = Math.max(0, hud.top), floor = Math.min(innerHeight, hud.bottom);
          const at = { shown: Math.round(Math.min(box.bottom, floor) - Math.max(box.top, ceiling)), wanted: Math.round(Math.min(box.height, floor - ceiling)), pageScroll: scrollY + document.documentElement.scrollTop };
          return { ...at, height: box.height, ok: at.shown >= at.wanted - 2 && at.pageScroll === 0 };
        };
        // Panels that load their content grow after they open, and a software-rendered frame can take a second, so the panel is judged once its height has held for a second.
        let at = await panel.evaluate(measure), held = 0;
        for (const until = Date.now() + 10_000; !(at.ok && held >= 4) && Date.now() < until;) {
          await page.waitForTimeout(250);
          const next = await panel.evaluate(measure); held = next.height === at.height ? held + 1 : 0; at = next;
        }
        const ok = at.ok && held >= 4;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${viewport.width} list=${listOpen ? 'open' : 'shut'} ${id} shows ${at.shown}px of ${at.wanted}px pageScroll ${at.pageScroll}`);
        if (!ok) failures.push(`${viewport.width} ${listOpen ? 'list open' : 'list shut'} ${id}`);
        await button.click();
      }
    }
    await page.close();
  }
} finally { await browser.close(); await worker.stop(); fs.rmSync(persistTo, { recursive: true, force: true }); }
if (failures.length) { console.error(`panel not in view: ${failures.join(', ')}`); process.exitCode = 1; }

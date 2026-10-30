// Builds the app, runs it on `wrangler dev --env local`, writes a cart, turns sharing on with price ranges, and saves the
// owner's room with the share panel open and the visitor's /s/<slug> page, each at desktop and phone sizes, to
// docs/screenshots (and a copy of the share card the panel downloads to .local). Run: node scripts/screenshots-share.mjs
// Needs Playwright's Chromium (npx playwright-core install chromium) on the machine; CI does not run this.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';

const viewports = [
  { size: '1440', viewport: { width: 1440, height: 900 } },
  { size: '390', viewport: { width: 390, height: 844 }, hasTouch: true },
];
const out = path.join(root, 'docs/screenshots');
const copyTo = process.env.SHARE_SCREENSHOTS_COPY_TO;
const token = crypto.randomBytes(24).toString('base64url');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const persistTo = fs.mkdtempSync(path.join(root, '.local', 'screenshots-share-'));
build();
const worker = await startWorker(persistTo, { CART_MCP_TOKEN: token, SEED_FIXTURE: 'false' });
const owner = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const items = [
  { title: '手沖咖啡濾杯 陶瓷 02', store: '山嵐咖啡器材', url: 'https://example.com/shanlan/dripper-02?ref=muse&uid=42#buy', priceTwd: 650, imageUrl: `${worker.origin}/art/characters/clerk-portrait.png` },
  { title: '無線降噪耳機', store: '青田電器行', url: 'https://example.com/qingtian/anc-headphones', priceTwd: 3990 },
  { title: '帆布托特包 燕麥色', store: '巷口布作', url: 'https://example.com/xiangkou/canvas-tote', priceTwd: 880, qty: 2 },
  { title: '鑄鐵平底鍋 24cm', store: '灶腳生活', priceTwd: 1580 },
  { title: '試用包（無標價）', qty: 3 },
];
const browser = await launchBrowser();
const report = [];
const shoot = async (page, file, ready) => {
  await page.waitForSelector('.house-world[data-render-ready="true"][data-renderer="three-webgl"]', { timeout: 60_000 });
  await page.waitForFunction(ready, items.length, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, file) });
  if (copyTo) fs.copyFileSync(path.join(out, file), path.join(copyTo, file));
  return page.evaluate(() => { const room = document.querySelector('.room-canvas'); return { shelf: Number(room?.getAttribute('data-cart-shelf')), register: room?.getAttribute('data-register'), registerTag: document.querySelector('[data-testid="register-tag"]')?.textContent }; });
};
try {
  assert.equal((await fetch(`${worker.origin}/api/cart`, { method: 'POST', headers: owner, body: JSON.stringify({ items }) })).status, 200, 'cart written');
  const share = await (await fetch(`${worker.origin}/api/share`, { method: 'PUT', headers: owner, body: JSON.stringify({ enabled: true, prices: 'range', nickname: '小島' }) })).json();
  assert.equal(share.prices, 'range', 'sharing on with price ranges');
  for (const { size, viewport, hasTouch } of viewports) {
    const page = await browser.newPage({ viewport, hasTouch, locale: 'zh-TW', acceptDownloads: true });
    const problems = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });

    await page.goto(worker.origin);
    await page.waitForSelector('[data-testid="share-button"]', { timeout: 60_000 });
    await page.click('[data-testid="share-button"]');
    await page.waitForSelector('[data-testid="share-url"]', { timeout: 30_000 });
    const room = await shoot(page, `room-share-settings-${size}.png`, count => {
      const room = document.querySelector('.room-canvas');
      return room?.getAttribute('data-cart-shelf') === String(count) && room.getAttribute('data-register')?.startsWith('NT$ 5,000') && room.getAttribute('data-barista-source') !== 'loading' && (room.hasAttribute('data-studio-set') || room.hasAttribute('data-studio-set-error'));
    });
    assert.equal(room.register, 'NT$ 5,000–10,000', 'the room previews the visitor\'s range register while the panel is open');
    if (size === '1440') {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載分享卡' }).click()]);
      await download.saveAs(path.join(root, '.local', 'share-card-range.jpg'));
      if (copyTo) fs.copyFileSync(path.join(root, '.local', 'share-card-range.jpg'), path.join(copyTo, 'share-card-range.jpg'));
    }

    await page.goto(share.url);
    const visitor = await shoot(page, `share-page-${size}.png`, count => {
      const room = document.querySelector('.room-canvas');
      return room?.getAttribute('data-cart-shelf') === String(count) && room.getAttribute('data-barista-source') !== 'loading' && document.querySelector('[data-testid="share-hud"]') && (room.hasAttribute('data-studio-set') || room.hasAttribute('data-studio-set-error'));
    });
    const hud = await page.evaluate(() => ({ title: document.title, total: document.querySelector('[data-testid="share-total"]')?.textContent, links: [...document.querySelectorAll('.share-list a')].map(a => ({ href: a.getAttribute('href'), rel: a.getAttribute('rel') })), text: document.querySelector('[data-testid="share-hud"]')?.textContent ?? '' }));
    assert.equal(visitor.register, 'NT$ 5,000–10,000', 'the visitor\'s register shows the total\'s range');
    assert.ok(!/(?<!\d)(650|3,990|880|1,580|7,980)(?!\d)/.test(hud.text + visitor.register), 'no exact price on the visitor page');
    report.push({ size, room: { ...room, problems: problems.splice(0) }, visitor: { ...visitor, title: hud.title, total: hud.total, links: hud.links }, problems });
    await page.close();
  }
} finally { await browser.close(); await worker.stop(); fs.rmSync(persistTo, { recursive: true, force: true }); }
console.log(JSON.stringify(report, null, 2));

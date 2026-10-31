// Builds the app and saves the cast panel and the room at 1440 and 390 wide to $CAST_SCREENSHOTS_DIR (default .local/screenshots-cast):
// 1. a worker with no Meta key: the room with the default clerk (Muse) and the default owner figure, the panel with its "needs META_API_KEY"
//    note and a disabled button, then another clerk picked, kept over a reload;
// 2. a worker pointed at a fake Meta API on 127.0.0.1 (a made-up key, a PNG drawn here): a photo, the consent box, the generated
//    sprite beside its "AI generated" label, and the visitor's /s/<slug> page, which keeps the placeholder.
// Nothing here calls the real Meta Model API. Run: node scripts/screenshots-cast.mjs
// Needs Playwright's Chromium (npx playwright-core install chromium) on the machine; CI does not run this.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';

const viewports = [
  { size: '1440', viewport: { width: 1440, height: 900 } },
  { size: '390', viewport: { width: 390, height: 844 }, hasTouch: true },
];
const out = path.resolve(root, process.env.CAST_SCREENSHOTS_DIR ?? '.local/screenshots-cast');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const ready = '.house-world[data-render-ready="true"][data-renderer="three-webgl"]';
const settled = () => { const room = document.querySelector('.room-canvas'); return room?.getAttribute('data-barista-source') !== 'loading' && room?.getAttribute('data-owner-source') !== 'loading' && room?.hasAttribute('data-character') && (room.hasAttribute('data-studio-set') || room.hasAttribute('data-studio-set-error')); };
const roomAttr = (page, name) => page.evaluate(attribute => document.querySelector('.room-canvas')?.getAttribute(attribute), name);

const browser = await launchBrowser();
// A person-shaped PNG and a JPEG "photo", both drawn in the browser so the repo carries no picture of anyone.
const drawn = await (async () => {
  const page = await browser.newPage();
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3f6d8f'; ctx.beginPath(); ctx.roundRect(176, 300, 160, 150, 40); ctx.fill();
    ctx.fillStyle = '#2d3f4f'; ctx.fillRect(196, 440, 50, 56); ctx.fillRect(266, 440, 50, 56);
    ctx.fillStyle = '#f0c9a4'; ctx.beginPath(); ctx.arc(256, 200, 100, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b2b24'; ctx.beginPath(); ctx.arc(256, 160, 100, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#2a2420'; ctx.beginPath(); ctx.ellipse(220, 215, 9, 13, 0, 0, Math.PI * 2); ctx.ellipse(292, 215, 9, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a2420'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(256, 240, 22, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
    const photo = document.createElement('canvas'); photo.width = 300; photo.height = 400; const p = photo.getContext('2d');
    p.fillStyle = '#9db4c0'; p.fillRect(0, 0, 300, 400); p.drawImage(canvas, 0, 40, 300, 300);
    return { sprite: canvas.toDataURL('image/png'), photo: photo.toDataURL('image/jpeg', .9) };
  });
  await page.close();
  return { sprite: result.sprite.split(',')[1], photo: Buffer.from(result.photo.split(',')[1], 'base64') };
})();

const fakeKey = `fake-${crypto.randomBytes(12).toString('hex')}`;
const received = [];
const fakeMeta = http.createServer((request, response) => {
  let text = '';
  request.on('data', chunk => { text += chunk; }).on('end', () => {
    received.push({ method: request.method, url: request.url, authorized: request.headers.authorization === `Bearer ${fakeKey}`, body: JSON.parse(text || 'null') });
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ b64_json: drawn.sprite }] }));
  });
});
await new Promise(resolve => fakeMeta.listen(0, '127.0.0.1', resolve));
const fakeBase = `http://127.0.0.1:${fakeMeta.address().port}/v1`;

const report = [];
const open = async (worker, { viewport, hasTouch }, problems) => {
  const page = await browser.newPage({ viewport, hasTouch, locale: 'zh-TW' });
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  await page.goto(worker.origin);
  await page.waitForSelector(ready, { timeout: 60_000 });
  await page.waitForFunction(settled, undefined, { timeout: 60_000 });
  return page;
};
const shoot = async (page, name) => { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(out, name) }); };

const persistA = fs.mkdtempSync(path.join(root, '.local', 'screenshots-cast-'));
const persistB = fs.mkdtempSync(path.join(root, '.local', 'screenshots-cast-'));
build();
const workerA = await startWorker(persistA, { SEED_FIXTURE: 'true' });
const workerB = await startWorker(persistB, { SEED_FIXTURE: 'true', META_API_KEY: fakeKey, META_API_BASE_URL: fakeBase });
try {
  for (const shape of viewports) {
    const problems = [], { size } = shape;
    const page = await open(workerA, shape, problems);
    assert.equal(await roomAttr(page, 'data-character'), 'muse', 'the default clerk');
    assert.equal(await roomAttr(page, 'data-barista-source'), 'sheet', 'Muse walks on her sheet');
    assert.equal(await roomAttr(page, 'data-owner-source'), 'sheet', 'the owner spot starts as the generated shop owner');
    await shoot(page, `room-muse-and-owner-${size}.png`);

    await page.click('[data-testid="cast-button"]');
    await page.waitForSelector('[data-testid="cast-panel"] [data-testid="cast-sprite"]');
    assert.equal(await page.isDisabled('[data-testid="cast-generate"]'), true, 'no key: the button is disabled');
    const needs = await page.textContent('[data-testid="cast-needs-key"]');
    assert.match(needs, /META_API_KEY/, 'no key: the panel says what to set');
    await shoot(page, `cast-panel-no-key-${size}.png`);

    await page.click('[data-character="apron"]');
    await page.waitForFunction(() => document.querySelector('.room-canvas')?.getAttribute('data-character') === 'apron' && document.querySelector('.room-canvas')?.getAttribute('data-barista-source') !== 'loading');
    await shoot(page, `cast-panel-after-${size}.png`);
    const saved = await (await fetch(`${workerA.origin}/api/cast`)).json();
    assert.equal(saved.character, 'apron', 'the pick is stored');
    assert.deepEqual(saved.spriteGeneration, { available: false, reason: 'needs_meta_api_key' });

    await page.reload();
    await page.waitForSelector(ready, { timeout: 60_000 });
    await page.waitForFunction(settled, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector('.room-canvas')?.getAttribute('data-character') === 'apron');
    await shoot(page, `room-clerk-changed-${size}.png`);
    report.push({ size, step: 'no key', character: await roomAttr(page, 'data-character'), needs, problems: problems.splice(0) });
    await page.close();
    await fetch(`${workerA.origin}/api/cast`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ character: 'muse' }) });
  }

  const share = await (await fetch(`${workerB.origin}/api/share`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, prices: 'hidden', nickname: '小島' }) })).json();
  for (const shape of viewports) {
    const problems = [], { size } = shape;
    const page = await open(workerB, shape, problems);
    await page.click('[data-testid="cast-button"]');
    await page.waitForSelector('[data-testid="cast-generate"]');
    assert.equal(await page.isDisabled('[data-testid="cast-generate"]'), true, 'a key is set but there is no photo or consent yet');
    assert.equal(await page.locator('[data-testid="cast-needs-key"]').count(), 0, 'with a key there is no note');
    await page.setInputFiles('#cast-photo', { name: 'me.jpg', mimeType: 'image/jpeg', buffer: drawn.photo });
    assert.equal(await page.isDisabled('[data-testid="cast-generate"]'), true, 'a photo without consent still cannot be sent');
    await page.check('[data-testid="cast-consent"]');
    await page.click('[data-testid="cast-generate"]');
    await page.waitForSelector('[data-testid="cast-sprite"][data-kind="generated"]', { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('.room-canvas')?.getAttribute('data-owner-source') === 'generated', undefined, { timeout: 30_000 });
    assert.ok(await page.isVisible('[data-testid="cast-ai-label"]'), 'the AI label sits by the sprite');
    await shoot(page, `cast-generated-${size}.png`);
    await page.click('[data-testid="cast-panel"] button[aria-label="關閉"]');
    await shoot(page, `room-owner-generated-${size}.png`);

    const visitor = await browser.newPage({ viewport: shape.viewport, hasTouch: shape.hasTouch, locale: 'zh-TW' });
    visitor.on('pageerror', error => problems.push(error.message));
    await visitor.goto(share.url);
    await visitor.waitForSelector(ready, { timeout: 60_000 });
    await visitor.waitForFunction(() => { const room = document.querySelector('.room-canvas'); return room?.getAttribute('data-owner-source') && room.getAttribute('data-owner-source') !== 'loading' && room.getAttribute('data-barista-source') !== 'loading'; }, undefined, { timeout: 60_000 });
    assert.equal(await roomAttr(visitor, 'data-owner-source'), 'sheet', 'a visitor sees the shop owner, not the owner\'s photo sprite');
    const body = await (await fetch(share.url, { headers: { accept: 'application/json' } })).text();
    assert.ok(!/owner\/|sprite|generated/.test(body), 'the share view carries nothing of the sprite');
    await shoot(visitor, `share-visitor-owner-${size}.png`);
    await visitor.close();
    report.push({ size, step: 'with a fake key', problems: problems.splice(0) });
    await page.close();
    if (size === '1440') await fetch(`${workerB.origin}/api/cast/owner-sprite`, { method: 'DELETE' });
  }

  // 3. Motion on a fresh worker per size (the parcels start closed): a mid-walk frame, the cheer and the clerk's trip to the shelf after an unbox, and the reaction to a new item.
  for (const shape of viewports) {
    const problems = [], { size } = shape;
    const persistM = fs.mkdtempSync(path.join(root, '.local', 'screenshots-cast-'));
    const workerM = await startWorker(persistM, { SEED_FIXTURE: 'true' });
    try {
    const page = await open(workerM, shape, problems);
    const motion = () => page.evaluate(() => JSON.parse(document.querySelector('.room-canvas').dataset.castMotion));
    const until = async (test, what, ms = 60_000) => { const end = Date.now() + ms; for (;;) { const value = await test(); if (value) return value; if (Date.now() > end) throw new Error(`timed out: ${what}`); await page.waitForTimeout(100); } };
    const walker = await until(async () => { const m = await motion(); return m.owner.moving ? 'owner' : m.clerk.moving ? 'clerk' : null; }, 'a figure walking');
    await page.screenshot({ path: path.join(out, `motion-mid-walk-${size}.png`) });
    report.push({ size, step: 'mid-walk', walker, motion: await motion() });
    const items = (await (await fetch(`${workerM.origin}/api/cart`)).json()).items.map(({ title, store, url, priceTwd, imageUrl, qty }) => Object.fromEntries(Object.entries({ title, store, url, priceTwd, imageUrl, qty }).filter(([, value]) => value != null)));
    await page.waitForSelector('[data-testid="unbox-all"]');
    await page.click('[data-testid="unbox-all"]');
    await until(() => page.evaluate(() => document.querySelector('.room-canvas').dataset.cue === 'unboxed'), 'the unboxed cue');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `motion-unboxed-cheer-${size}.png`) });
    const fetched = await until(async () => { const m = await motion(); return m.clerk.moving && m.clerk.z < -3.9 ? m : null; }, 'the clerk walking to the shelf', 15_000).catch(() => null);
    if (fetched) await page.screenshot({ path: path.join(out, `motion-clerk-to-shelf-${size}.png`) });
    report.push({ size, step: 'unboxed', clerkToShelf: fetched?.clerk ?? null });
    const next = [...items, { title: '木頭湯匙', store: '小島陶房', priceTwd: 180, qty: 1 }];
    await fetch(`${workerM.origin}/api/cart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: next }) });
    await until(() => page.evaluate(() => document.querySelector('.room-canvas').dataset.cue === 'arrival'), 'the arrival cue', 20_000);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, `motion-new-item-${size}.png`) });
    const poked = await page.evaluate(() => { const room = document.querySelector('.room-canvas'); return room.dataset.cue; });
    report.push({ size, step: 'new item', cue: poked, problems: problems.splice(0) });
    await page.close();
    } finally { await workerM.stop(); fs.rmSync(persistM, { recursive: true, force: true }); }
  }

  assert.ok(received.length >= 1, 'the fake Meta API was asked');
  for (const call of received) {
    assert.equal(call.method, 'POST'); assert.equal(call.url, '/v1/images/generations'); assert.ok(call.authorized, 'the bearer key was sent');
    assert.equal(call.body.model, 'muse-image-1.0'); assert.equal(call.body.enable_image_search, false);
    assert.ok(!/muse|jolly|mascot|meta/i.test(call.body.prompt), 'the prompt names no brand');
  }
  report.push({ fakeMetaCalls: received.map(call => ({ model: call.body.model, enable_image_search: call.body.enable_image_search, fields: Object.keys(call.body) })) });
} finally {
  await browser.close(); await workerA.stop(); await workerB.stop(); fakeMeta.close();
  fs.rmSync(persistA, { recursive: true, force: true }); fs.rmSync(persistB, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
console.log(`screenshots in ${path.relative(root, out) || out}`);

// Drives the owner's remove flow in a real browser against a running `wrangler dev --env local` (five-item fixture): remove an item with a
// reason, undo another, then read the removal back over /mcp as Muse would (cart_list, and the note cart_add gives for the removed link).
// Needs ORIGIN (e.g. http://127.0.0.1:8881) and CART_MCP_TOKEN in the environment, and REMOVE_SCREENSHOTS_DIR for the pictures.
// Run: ORIGIN=... CART_MCP_TOKEN=... node scripts/verify-remove.mjs. Needs Playwright's Chromium; CI does not run this.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';

const origin = process.env.ORIGIN, token = process.env.CART_MCP_TOKEN, out = path.resolve(process.env.REMOVE_SCREENSHOTS_DIR ?? '.local/screenshots-remove');
assert(origin && token, 'set ORIGIN and CART_MCP_TOKEN');
fs.mkdirSync(out, { recursive: true });
let id = 0;
const call = async (name, args = {}) => {
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
  return (await response.json()).result.structuredContent;
};
const cart = async () => (await fetch(`${origin}/api/cart`)).json();

const browser = await launchBrowser();
try {
  for (const [size, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, locale: 'zh-TW' });
    const problems = [];
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    const shoot = name => page.screenshot({ path: path.join(out, `remove-${name}-${size}.png`) });
    await page.goto(origin);
    await page.waitForSelector('.house-world[data-render-ready="true"][data-renderer="three-webgl"]', { timeout: 60_000 });
    const before = (await cart()).items;
    assert(before.length >= 2, 'the cart has items to take out');
    await page.waitForTimeout(1500);
    await page.click('.cart-toggle');
    const rows = page.locator('[data-testid="cart-row"]');
    assert.equal(await rows.count(), before.length);

    const first = before[0];
    await rows.nth(0).locator('[data-testid="cart-remove"]').click();
    await page.waitForSelector('[data-testid="remove-reasons"]');
    await shoot('1-reasons');
    await page.click('[data-testid="remove-reason-too_expensive"]');
    await page.waitForSelector('[data-testid="remove-undo"]');
    assert.equal(await rows.count(), before.length - 1, 'the row is hidden at once');
    assert.equal((await cart()).items.length, before.length, 'but the worker has not heard yet: the undo window is open');
    await shoot('2-undo-bar');
    await page.waitForFunction(async () => (await (await fetch('/api/cart')).json()).items.length === arguments[0], before.length - 1, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(5500);
    const after = (await cart()).items;
    assert.equal(after.length, before.length - 1, 'the removal is final after the window');
    assert(!after.some(item => item.id === first.id));
    await page.waitForTimeout(2500);
    assert.equal(await rows.count(), before.length - 1);
    assert.equal(await page.locator('[data-testid="remove-undo"]').count(), 0, 'the undo bar is gone');
    await shoot('3-removed');

    const second = after[0];
    await rows.nth(0).locator('[data-testid="cart-remove"]').click();
    await page.click('[data-testid="remove-reason-changed_mind"]');
    assert.equal(await rows.count(), after.length - 1);
    await page.click('[data-testid="remove-undo-button"]');
    assert.equal(await rows.count(), after.length, 'undo brings the row back');
    await shoot('4-undone');
    await page.waitForTimeout(6500);
    assert.equal((await cart()).items.length, after.length, 'an undone removal never reaches the worker');
    assert.equal(await rows.count(), after.length);

    const listed = await call('cart_list');
    const latest = listed.removals[0];
    assert.equal(latest.item.title, first.title);
    assert.equal(latest.reason, 'too_expensive');
    assert.equal(latest.by, 'owner');
    assert(!listed.removals.some(removal => removal.item.title === second.title), 'the undone one is not in the log');
    fs.writeFileSync(path.join(out, `cart_list-${size}.json`), `${JSON.stringify({ removals: listed.removals }, null, 2)}\n`);
    const added = await call('cart_add', { title: first.title, url: first.url ?? undefined });
    assert(added.note?.includes('太貴'), `cart_add warns about the removed item: ${added.note}`);
    fs.writeFileSync(path.join(out, `cart_add-note-${size}.txt`), `${added.note}\n`);
    await call('cart_remove', { itemId: added.items.at(-1).id });
    assert.deepEqual(problems, [], 'no console errors');
    await page.close();
    // Put the first item's removal behind us for the next size: the log keeps it, which the next size's cart_list still shows.
    await fetch(`${origin}/api/cart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: before.map(({ title, store, url, priceTwd, imageUrl, category, qty }) => Object.fromEntries(Object.entries({ title, store, url, priceTwd, imageUrl, category, qty }).filter(([, value]) => value !== null))) }) });
  }
  console.log(`removal flow verified; pictures in ${out}`);
} finally {
  await browser.close();
}

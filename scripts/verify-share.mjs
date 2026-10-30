// Walks the share flow against a real `wrangler dev` (workerd + Durable Object storage on disk) behind the production gate:
// a token and no open owner access. Writes a cart, checks /api/cart is owner-only, turns sharing on in each price mode and
// checks what /s/<slug> hands a visitor, then turns it off again. Run: node scripts/verify-share.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';

const token = crypto.randomBytes(24).toString('base64url');
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const persistTo = fs.mkdtempSync(path.join(root, '.local', 'verify-share-'));
build();

const worker = await startWorker(persistTo, { CART_MCP_TOKEN: token, OPEN_OWNER_ACCESS: 'false', SEED_FIXTURE: 'false' });
const owner = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
// 420×2 + 1290 = 2130: no price or total sits on a bucket bound, so a range view cannot contain one by accident.
const items = [
  { title: '陶瓷馬克杯', store: '小島陶房', url: 'https://user:pw@shop.example/p/1?ref=abc&uid=42#frag', priceTwd: 420, qty: 2 },
  { title: '亞麻餐墊', store: '巷口布作', url: 'https://shop.example/p/2', priceTwd: 1290 },
  { title: '試用包', qty: 3 },
];
const exact = [420, 1290, 2130];
const hasNumber = (text, amount) => new RegExp(`(?<!\\d)${amount}(?!\\d)`).test(text);
const keysOf = value => Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]) : [];
const visit = (path, accept = 'application/json', init = {}) => fetch(`${worker.origin}${path}`, { ...init, headers: { accept } });
const settle = async body => {
  const response = await fetch(`${worker.origin}/api/share`, { method: 'PUT', headers: owner, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `PUT /api/share ${JSON.stringify(body)} accepted`);
  return response.json();
};
const summary = {};

try {
  const written = await fetch(`${worker.origin}/api/cart`, { method: 'POST', headers: owner, body: JSON.stringify({ items }) });
  assert.equal(written.status, 200, 'the owner writes the cart with the token');
  const cart = await written.json();
  assert.equal(cart.totalTwd, 2130);

  assert.equal((await fetch(`${worker.origin}/api/cart`)).status, 401, 'GET /api/cart without the token is refused');
  assert.equal((await fetch(`${worker.origin}/api/cart`, { headers: { authorization: 'Bearer not-the-token' } })).status, 401, 'GET /api/cart with a wrong token is refused');
  assert.equal((await fetch(`${worker.origin}/api/cart`, { headers: owner })).status, 200, 'GET /api/cart with the token answers');
  assert.equal((await fetch(`${worker.origin}/api/share`)).status, 401, 'GET /api/share without the token is refused');

  const first = await (await fetch(`${worker.origin}/api/share`, { headers: owner })).json();
  assert.equal(first.enabled, false, 'sharing starts off');
  assert.equal(first.prices, 'hidden', 'prices start hidden');
  assert.match(first.slug, /^[A-Za-z0-9_-]{22}$/);
  const link = `/s/${first.slug}`;

  const closed = await visit(link), closedBody = await closed.text(), closedPage = await (await visit(link, 'text/html')).text();
  assert.equal(closed.status, 404, 'a link that is off answers 404');
  assert.deepEqual(JSON.parse(closedBody), { error: 'not_found' });
  for (const name of ['cache-control', 'vary', 'referrer-policy', 'x-robots-tag']) assert.ok(closed.headers.get(name), `the 404 carries ${name}`);

  await settle({ enabled: true, prices: 'hidden', nickname: '小島' });
  const hiddenText = await (await visit(link)).text(), hidden = JSON.parse(hiddenText);
  assert.equal(hidden.prices, 'hidden');
  assert.deepEqual(keysOf(hidden).filter(key => /price|total/i.test(key)), ['prices'], 'hidden: no field that could hold a price');
  for (const amount of exact) assert.ok(!hasNumber(hiddenText, amount), `hidden: ${amount} appears nowhere`);
  assert.equal(hidden.items[0].url, 'https://shop.example/p/1', 'the product link loses its query, fragment and credentials');
  for (const leak of ['ref=abc', 'uid=42', 'frag', 'user:pw', '小島陶房', ...cart.items.map(item => item.id)]) assert.ok(!hiddenText.includes(leak), `${leak} stays private`);
  summary.hidden = hidden.items.map(item => `${item.title} x${item.qty}`);

  await settle({ enabled: true, prices: 'range', nickname: '小島' });
  const rangeText = await (await visit(link)).text(), range = JSON.parse(rangeText);
  assert.deepEqual(range.items.map(item => item.priceRange), [{ minTwd: 300, maxTwd: 500 }, { minTwd: 1000, maxTwd: 3000 }, null], 'range: a bucket per priced item');
  assert.deepEqual(range.totalRange, { minTwd: 1000, maxTwd: 3000 }, 'range: the total as a bucket');
  assert.ok(!keysOf(range).some(key => key === 'priceTwd' || key === 'totalTwd'), 'range: no exact fields');
  for (const amount of exact) assert.ok(!hasNumber(rangeText, amount), `range: ${amount} appears nowhere`);
  summary.range = { items: range.items.map(item => item.priceRange && `${item.priceRange.minTwd}–${item.priceRange.maxTwd}`), total: `${range.totalRange.minTwd}–${range.totalRange.maxTwd}` };

  await settle({ enabled: true, prices: 'exact', nickname: '小島' });
  const exactView = await (await visit(link)).json();
  assert.deepEqual(exactView.items.map(item => item.priceTwd), [420, 1290, null], 'exact: every price as written');
  assert.equal(exactView.totalTwd, 2130, 'exact: the cart total');
  summary.exact = { items: exactView.items.map(item => item.priceTwd), total: exactView.totalTwd };

  const page = await visit(link, 'text/html');
  const html = await page.text();
  assert.equal(page.status, 200, 'a browser gets the app');
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.ok(html.includes('<meta property="og:title" content="小島 的小屋購物車"/>'), 'og:title names the owner');
  assert.ok(html.includes('<meta property="og:description" content="3 件東西"/>'), 'og:description counts the items');
  assert.ok(html.includes('<div id="root">'), 'the page is the built app');
  for (const amount of exact) assert.ok(!hasNumber(html, amount), `the page head has no ${amount}`);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('x-robots-tag'), 'noindex');

  const wrong = `/s/${first.slug.startsWith('A') ? 'B' : 'A'}${first.slug.slice(1)}`;
  assert.equal(await (await visit(wrong)).text(), closedBody, 'a wrong slug gets the same 404 body');
  assert.equal(await (await visit(wrong, 'text/html')).text(), closedPage, 'a wrong slug gets the same 404 page');
  assert.equal(await (await visit(`/s/${first.slug}x`)).text(), closedBody, 'a malformed slug gets the same 404 body');
  const posted = await visit(link, 'application/json', { method: 'POST' });
  assert.equal(posted.status, 405, 'POST /s/<slug> is refused');
  assert.equal(posted.headers.get('allow'), 'GET');

  await settle({ enabled: false, prices: 'exact', nickname: '小島' });
  const off = await visit(link), offPage = await visit(link, 'text/html');
  assert.equal(off.status, 404, 'turned off: JSON 404');
  assert.equal(await off.text(), closedBody);
  assert.equal(offPage.status, 404, 'turned off: HTML 404');
  assert.equal(await offPage.text(), closedPage);

  console.log(JSON.stringify({ slug: '<22 chars>', ownerOnly: { noToken: 401, wrongToken: 401, token: 200 }, ...summary, html: { status: 200, ogTitle: '小島 的小屋購物車' }, wrongSlug: 404, malformed: 404, post: 405, afterOff: [404, 404] }, null, 2));
} finally {
  await worker.stop();
  fs.rmSync(persistTo, { recursive: true, force: true });
}

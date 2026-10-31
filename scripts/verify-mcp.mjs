// Drives the /mcp endpoint of a real `wrangler dev` (workerd + Durable Object storage on disk) through the whole path an
// agent takes: record purchases, read the share link, queue an intro video, poll it. Run: node scripts/verify-mcp.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';
import { mcpClient } from './lib/mcp.mjs';

const token = crypto.randomBytes(24).toString('base64url');
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const persistTo = fs.mkdtempSync(path.join(root, '.local', 'verify-mcp-'));
build();

// SEED_FIXTURE off so the cart holds only what this script adds.
const worker = await startWorker(persistTo, { CART_MCP_TOKEN: token, SEED_FIXTURE: 'false' });
const { rpc, call } = mcpClient(worker.origin, token);

try {
  assert.equal((await rpc('ping', {}, null)).status, 401, 'no token is refused');
  assert.equal((await rpc('ping', {}, 'Bearer not-the-token')).status, 401, 'a wrong token is refused even though env.local opens owner access');

  const init = await (await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'verify-mcp', version: '0' } })).json();
  assert.equal(init.result.protocolVersion, '2025-11-25');
  const { tools } = (await (await rpc('tools/list')).json()).result;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['cart_add', 'cart_list', 'cart_remove', 'promo_generate', 'promo_status']);
  assert.deepEqual(tools.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name).sort(), ['cart_list', 'promo_status']);

  await call('cart_add', { title: '陶瓷馬克杯', store: '小島陶房', priceTwd: 420, qty: 2 });
  await call('cart_add', { title: '亞麻餐墊', priceTwd: 290 });
  const listed = await call('cart_list', {});
  assert.deepEqual(listed.items.map(item => item.title), ['陶瓷馬克杯', '亞麻餐墊']);
  assert.match(listed.share.url, /^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]{22}$/, 'share url is origin + /s/<slug>');
  assert.equal(listed.share.enabled, false, 'sharing starts disabled');
  assert.equal(listed.share.prices, 'hidden', 'visitors see no prices until the owner picks otherwise');
  assert.equal((await call('cart_list', {})).share.url, listed.share.url, 'the slug is stable');

  const removed = await call('cart_remove', { itemId: listed.items[1].id });
  assert.deepEqual(removed.items.map(item => item.title), ['陶瓷馬克杯']);
  const queued = await call('promo_generate', {});
  assert.equal(queued.status, 'queued');
  assert.equal((await call('promo_generate', {})).jobId, queued.jobId, 'a retried call reuses the queued job');
  const job = await call('promo_status', { jobId: queued.jobId });
  assert.equal(job.status, 'queued');
  assert.equal(job.cartRevision, removed.revision, 'the job is for the cart as it was queued');

  const api = await (await fetch(`${worker.origin}/api/cart`)).json();
  assert.deepEqual(api, removed, 'GET /api/cart (open to the owner in env.local) returns the cart the agent wrote');

  console.log(JSON.stringify({ tools: tools.map(tool => tool.name), items: api.items.map(item => `${item.title} x${item.qty}`), shareUrl: listed.share.url.replace(/\/s\/.+$/, '/s/<22 chars>'), shareEnabled: listed.share.enabled, sharePrices: listed.share.prices, job: { id: job.id, status: job.status, cartRevision: job.cartRevision }, unauthorized: [401, 401] }, null, 2));
} finally {
  await worker.stop();
  fs.rmSync(persistTo, { recursive: true, force: true });
}

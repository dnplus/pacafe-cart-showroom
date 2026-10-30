// Writes a cart to a real `wrangler dev` (workerd + Durable Object storage on disk), stops it, starts it again on the
// same --persist-to directory and checks the cart read back is the one written. Run: node scripts/verify-persist.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build, root, startWorker } from './lib/wrangler.mjs';

const items = [
  { title: '陶瓷馬克杯', store: '小島陶房', url: 'https://example.com/xiaodao/mug', priceTwd: 420, qty: 2 },
  { title: '亞麻餐墊', store: '巷口布作', priceTwd: 290 },
  { title: '試用包（無標價）', qty: 3 },
];
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const persistTo = fs.mkdtempSync(path.join(root, '.local', 'verify-persist-'));
build();

const first = await startWorker(persistTo);
let written;
try {
  const response = await fetch(`${first.origin}/api/cart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
  assert.equal(response.status, 200, 'POST /api/cart accepted');
  written = await response.json();
  assert.equal(written.totalTwd, 420 * 2 + 290, 'total is price x qty, unpriced counts 0');
} finally { await first.stop(); }

const second = await startWorker(persistTo);
let reread;
try { reread = await (await fetch(`${second.origin}/api/cart`)).json(); } finally { await second.stop(); }

assert.deepEqual(reread, written, 'the cart read after a restart is the cart written before it');
console.log(JSON.stringify({ persistTo: path.relative(root, persistTo), restarted: true, revision: reread.revision, items: reread.items.map(item => `${item.shelfSlot}: ${item.title} x${item.qty}`), totalTwd: reread.totalTwd, fill: reread.fill, equal: true }, null, 2));
fs.rmSync(persistTo, { recursive: true, force: true });

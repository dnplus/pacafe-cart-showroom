// Runs adapter/cli.ts against a real `wrangler dev`: a dry run that must print the request with the five function tools, then a
// live run against a local stand-in for the Model API that asks for one cart_add and then answers. Run: node scripts/verify-adapter.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';

const token = crypto.randomBytes(24).toString('base64url');
const modelKey = crypto.randomBytes(12).toString('base64url');
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const persistTo = fs.mkdtempSync(path.join(root, '.local', 'verify-adapter-'));
build();

const requests = [];
const model = http.createServer(async (req, res) => {
  assert.equal(req.headers.authorization, `Bearer ${modelKey}`);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  requests.push(JSON.parse(raw));
  const reply = requests.length === 1
    ? { id: 'resp-1', output: [{ type: 'function_call', call_id: 'call-1', name: 'cart_add', arguments: JSON.stringify({ title: '陶瓷馬克杯', priceTwd: 420, qty: 2 }) }] }
    : { id: 'resp-2', output: [{ type: 'message', content: [{ type: 'output_text', text: '記好了。' }] }] };
  res.setHeader('content-type', 'application/json').end(JSON.stringify(reply));
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));

const worker = await startWorker(persistTo, { CART_MCP_TOKEN: token, SEED_FIXTURE: 'false' });
// Async: a synchronous spawn would block the event loop that serves the stand-in Model API.
const cli = (args, env) => new Promise(resolve => execFile('node', ['adapter/cli.ts', '--prompt-file', 'muse/demo-task.txt', ...args], {
  cwd: root, encoding: 'utf-8', env: { PATH: process.env.PATH, SHOWROOM_MCP_URL: `${worker.origin}/mcp`, CART_MCP_TOKEN: token, ...env },
}, (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr })));

try {
  const dry = await cli(['--dry-run']);
  assert.equal(dry.status, 0, `dry run exited 0: ${dry.stderr}`);
  const body = JSON.parse(dry.stdout);
  assert.deepEqual(body.tools.map(tool => tool.name).sort(), ['cart_add', 'cart_list', 'cart_remove', 'promo_generate', 'promo_status']);
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.model, 'muse-spark-1.3');
  assert.match(body.instructions, /showroom-cart/);
  assert.match(body.instructions, /showroom-promo/);
  assert.match(body.input, /陶瓷馬克杯/);
  assert.equal(requests.length, 0, 'a dry run makes no Model API call');

  const missing = await cli([], {});
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /META_API_KEY/);

  const live = await cli(['--max-steps', '5'], { META_API_KEY: modelKey, META_API_BASE_URL: `http://127.0.0.1:${model.address().port}/v1` });
  assert.equal(live.status, 0, `live run exited 0: ${live.stderr}`);
  assert.equal(live.stdout.trim(), '記好了。');
  assert.equal(requests[1].previous_response_id, 'resp-1');
  assert.equal(requests[1].input[0].call_id, 'call-1');
  const cart = await (await fetch(`${worker.origin}/api/cart`)).json();
  assert.deepEqual(cart.items.map(item => `${item.title} x${item.qty}`), ['陶瓷馬克杯 x2'], 'the call reached the cart behind /api/cart');
  assert.ok(![live.stdout, live.stderr, dry.stderr].some(output => output.includes(token) || output.includes(modelKey)), 'no secret in the output');

  console.log(JSON.stringify({ dryRunTools: body.tools.map(tool => tool.name), modelRequests: requests.length, cart: cart.items.map(item => `${item.title} x${item.qty}`), answer: live.stdout.trim() }, null, 2));
} finally {
  model.close();
  await worker.stop();
  fs.rmSync(persistTo, { recursive: true, force: true });
}

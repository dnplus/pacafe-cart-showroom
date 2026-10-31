// Plays the promo runner over HTTP against a real `wrangler dev` (workerd, Durable Object storage and R2 on disk): an agent
// queues a video, the "runner" claims it, reports each step, uploads a stand-in mp4 and jpg and finishes; then the job, the
// room's /api/promo and /media/promo/... must all show the same done video. Run: node scripts/verify-runner.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';

const token = crypto.randomBytes(24).toString('base64url');
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const persistTo = fs.mkdtempSync(path.join(root, '.local', 'verify-runner-'));
build();

const worker = await startWorker(persistTo, { CART_MCP_TOKEN: token, SEED_FIXTURE: 'false' });
const auth = { authorization: `Bearer ${token}` };
const asJson = { ...auth, 'content-type': 'application/json' };
let id = 0;
const call = async (name, args) => {
  const response = await fetch(`${worker.origin}/mcp`, { method: 'POST', headers: { ...asJson, accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
  const { result } = await response.json();
  assert.equal(result.isError, false, `${name} succeeded: ${result.content?.[0]?.text}`);
  return result.structuredContent;
};
const next = () => fetch(`${worker.origin}/runner/next`, { method: 'POST', headers: auth });
// Reports and uploads go out under the claim they belong to, as runner/worker-client.ts sends them.
const report = (claim, update) => fetch(`${worker.origin}/runner/jobs/${claim.job.id}`, { method: 'POST', headers: { ...asJson, 'x-runner-claim': claim.claimId }, body: JSON.stringify(update) });
const upload = (claim, name, bytes) => fetch(`${worker.origin}/runner/jobs/${claim.job.id}/media/${name}`, { method: 'PUT', headers: { ...auth, 'x-runner-claim': claim.claimId }, body: bytes });
const room = path => fetch(`${worker.origin}${path}`).then(response => response.json());

// Not decodable video: the worker stores bytes and does not look inside them.
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), crypto.randomBytes(4096)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(1024)]);
const sha256 = crypto.createHash('sha256').update(mp4).digest('hex');

try {
  assert.equal((await fetch(`${worker.origin}/runner/next`, { method: 'POST' })).status, 401, 'no token is refused');
  assert.equal((await fetch(`${worker.origin}/runner/next`, { method: 'POST', headers: { authorization: 'Bearer not-the-token' } })).status, 401, 'a wrong token is refused even though env.local opens owner access');
  assert.equal((await next()).status, 204, 'nothing waits yet');

  await call('cart_add', { title: '陶瓷馬克杯', store: '小島陶房', priceTwd: 420, qty: 2 });
  const queued = await call('promo_generate', { durationSec: 20 });
  const viaRoom = await (await fetch(`${worker.origin}/api/promo`, { method: 'POST', headers: asJson, body: JSON.stringify({ durationSec: 20 }) })).json();
  assert.equal(viaRoom.jobId, queued.jobId, 'the room and the MCP tool queue the same job');

  const claimResponse = await next();
  assert.equal(claimResponse.status, 200);
  const claim = await claimResponse.json();
  assert.equal(claim.job.id, queued.jobId);
  assert.equal(claim.job.status, 'storyboard');
  assert.equal(claim.view.mode, 'hidden', 'sharing is off and prices default to hidden');
  assert.ok(!/priceTwd|priceRange|totalTwd|totalRange|420/.test(JSON.stringify(claim)), 'a hidden view hands the runner no price');
  assert.equal((await next()).status, 204, 'a claimed job is not offered again while its lease holds');

  assert.equal((await report({ ...claim, claimId: crypto.randomUUID() }, { status: 'storyboard', progress: 0.1, costUsd: 0 })).status, 409, 'a report under another claim is refused');
  assert.equal((await report(claim, { status: 'rendering', progress: 0, costUsd: 0 })).status, 409, 'storyboard cannot jump to rendering');
  for (const [status, progress] of [['storyboard', 0.5], ['voice', 0.3], ['rendering', 0.6]]) assert.equal((await report(claim, { status, progress, costUsd: 0.05 })).status, 200, `${status} reported`);
  assert.equal((await report(claim, { status: 'done', costUsd: 0.2, video: { sha256, durationSec: 19.8 } })).status, 409, 'done is refused before the files are uploaded');
  const stored = await (await upload(claim, 'video.mp4', mp4)).json();
  assert.equal(stored.key, `promo/${claim.job.id}/${claim.claimId}/video.mp4`);
  assert.equal((await upload(claim, 'thumbnail.jpg', jpg)).status, 200);
  const done = await (await report(claim, { status: 'done', costUsd: 0.2, video: { sha256, durationSec: 19.8 } })).json();
  assert.equal(done.status, 'done');

  const viaTool = await call('promo_status', { jobId: claim.job.id });
  assert.deepEqual(viaTool, done, 'promo_status shows the finished job');
  assert.deepEqual(await room('/api/promo'), done, '/api/promo shows the same job');
  assert.equal(done.output.videoUrl, `${worker.origin}/media/promo/${claim.job.id}/${claim.claimId}/video.mp4`);
  assert.equal(done.output.sha256, sha256);
  const video = await fetch(done.output.videoUrl);
  assert.equal(video.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await video.arrayBuffer()), mp4, 'the video is served byte for byte');
  assert.deepEqual(Buffer.from(await (await fetch(done.output.thumbnailUrl)).arrayBuffer()), jpg, 'the thumbnail is served byte for byte');
  const part = await fetch(done.output.videoUrl, { headers: { range: 'bytes=0-7' } });
  assert.equal(part.status, 206, 'a byte range is answered, so the video can seek');
  assert.equal((await next()).status, 204, 'a finished job is not offered again');

  await call('cart_add', { title: '亞麻餐墊', priceTwd: 290 });
  const second = await call('promo_generate', {});
  assert.notEqual(second.jobId, queued.jobId, 'a new cart gets a new job');
  const secondClaim = await (await next()).json();
  assert.equal(secondClaim.job.id, second.jobId);
  assert.equal((await report(secondClaim, { status: 'failed', costUsd: 0.01, error: '配音額度用完' })).status, 200);
  assert.equal((await room('/api/promo')).error, '配音額度用完', 'a failure shows in the room');

  console.log(JSON.stringify({ jobs: [queued.jobId, second.jobId].map(jobId => jobId.slice(0, 14) + '…'), steps: ['storyboard', 'voice', 'rendering', 'done'], video: { bytes: mp4.length, sha256: sha256.slice(0, 12) + '…', rangeStatus: part.status }, unauthorized: 401, idle: 204 }, null, 2));
} finally {
  await worker.stop();
  fs.rmSync(persistTo, { recursive: true, force: true });
}

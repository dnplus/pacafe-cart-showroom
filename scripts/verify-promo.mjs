// Runs the real promo runner (mock models, no voice, a real Remotion render) on one job and checks the video it uploads.
// npm run verify:promo: a real `wrangler dev`, with the job queued through /mcp promo_generate.
// node scripts/verify-promo.mjs --fake-worker: tests/fake-runner-worker.ts stands in for the worker's /runner/* routes.
// --script: the job carries a script Muse wrote (opening, six items, ending); qa.json must say muse wrote the storyboard.
// PROMO_VERIFY_COPY_TO=<dir> copies the video, thumbnail, qa.json and every QA frame there.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureCartItems } from '../shared/fixtures/cart.ts';
import { promoScriptSchema } from '../shared/script.ts';
import { claimFor, fakeRunnerWorker } from '../tests/fake-runner-worker.ts';
import { root } from './lib/root.mjs';
import { build, startWorker } from './lib/wrangler.mjs';

const fake = process.argv.includes('--fake-worker');
const withScript = process.argv.includes('--script');
const museScript = {
  opening: ['嗨，我是小島，歡迎來到我的小屋。', '這陣子 Muse 幫我採買，我們一件一件看。'],
  items: [
    { position: 1, title: '手沖咖啡濾杯', lines: ['週末的第一杯咖啡，全靠這個濾杯。'] },
    { position: 2, title: '降噪耳機', lines: ['通勤戴上它，整個世界就安靜了。'] },
    { position: 3, lines: ['這個托特包，我天天背著出門。'] },
    { position: 4, lines: ['鑄鐵鍋煎牛排，Muse 說一定要有。'] },
    { position: 5, lines: ['睡前翻翻《月亮上的貓》，很療癒。'] },
    { position: 6, title: '手沖壺', lines: ['配上這支細口壺，咖啡香整間屋子都聞得到，真的好喜歡。'] },
  ],
  ending: ['謝謝你來逛，慢慢看，喜歡的話就記下來。', '我們下次見！'],
};
const token = crypto.randomBytes(24).toString('base64url');
// Shop titles run long; this one is wider than a subtitle line, so the first QA round has something real to find.
const items = [...fixtureCartItems, { title: '【現貨】日本製琺瑯細口手沖壺 1.2L 附溫度計 霧面白', store: '山嵐咖啡器材', priceTwd: 2480, qty: 1 }];
fs.mkdirSync(path.join(root, '.local'), { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, '.local', 'verify-promo-'));
const auth = { authorization: `Bearer ${token}` };

async function queueOnWorker() {
  build();
  const worker = await startWorker(path.join(scratch, 'state'), { CART_MCP_TOKEN: token, SEED_FIXTURE: 'false' });
  const json = { ...auth, 'content-type': 'application/json' };
  assert.equal((await fetch(`${worker.origin}/api/cart`, { method: 'POST', headers: json, body: JSON.stringify({ items }) })).status, 200);
  assert.equal((await fetch(`${worker.origin}/api/share`, { method: 'PUT', headers: json, body: JSON.stringify({ enabled: false, prices: 'range', nickname: '小島' }) })).status, 200);
  const mcp = async (name, args) => {
    const response = await fetch(`${worker.origin}/mcp`, { method: 'POST', headers: { ...json, accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    const { result } = await response.json();
    assert.equal(result.isError, false, `${name}: ${result.content?.[0]?.text}`);
    return result.structuredContent;
  };
  const { jobId } = await mcp('promo_generate', { durationSec: 30, ...withScript ? { script: museScript } : {} });
  return {
    origin: worker.origin, jobId, stop: worker.stop,
    job: () => mcp('promo_status', { jobId }),
    media: async name => Buffer.from(await (await fetch(`${worker.origin}/media/promo/${jobId}/${name}`)).arrayBuffer()),
  };
}

async function queueOnFake() {
  const claim = claimFor(items, 'range', 30, withScript ? promoScriptSchema.parse(museScript) : undefined);
  const worker = await fakeRunnerWorker(token, [claim]);
  return { origin: worker.origin, jobId: claim.job.id, stop: worker.close, job: async () => worker.jobs.get(claim.job.id), media: async name => worker.uploads.get(`${claim.job.id}/${name}`) };
}

function runRunner(origin) {
  const env = { ...process.env, CART_MCP_TOKEN: token, TTS_PROVIDER: 'none', RUNNER_WORK_DIR: path.join(scratch, 'runner') };
  for (const name of ['META_API_KEY', 'META_API_BASE_URL', 'ELEVENLABS_API_KEY', 'MINIMAX_API_KEY']) delete env[name];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'runner/cli.ts'), '--once', '--origin', origin], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { log += chunk; process.stderr.write(chunk); });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, log }));
  });
}

const probe = file => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' }).stdout);

const worker = fake ? await queueOnFake() : await queueOnWorker();
try {
  const { code, log } = await runRunner(worker.origin);
  assert.doesNotMatch(log, /\/runner\/next answered 404/, 'the worker has no /runner/* routes yet; run with --fake-worker until they land');
  assert.equal(code, 0, 'the runner finished the job');
  assert.doesNotMatch(log, new RegExp(token), 'the runner never printed the token');
  const job = await worker.job();
  assert.equal(job.status, 'done', `job is done: ${job.error}`);

  const out = path.join(scratch, 'out');
  fs.mkdirSync(out);
  for (const name of ['video.mp4', 'thumbnail.jpg', 'qa.json']) fs.writeFileSync(path.join(out, name), await worker.media(name));
  const video = path.join(out, 'video.mp4');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex'), job.output.sha256, 'the uploaded video has the sha256 done reported');
  const info = probe(video);
  assert.deepEqual([info.streams[0].codec_name, info.streams[0].width, info.streams[0].height], ['h264', 1280, 720]);
  assert.ok(Math.abs(Number(info.format.duration) - 30) < 0.1, `the video runs 30 seconds, not ${info.format.duration}`);
  assert.equal(job.output.durationSec, 30);

  const qa = JSON.parse(fs.readFileSync(path.join(out, 'qa.json'), 'utf8'));
  assert.equal(qa.storyboard, withScript ? 'muse' : 'fallback');
  assert.ok(qa.rounds.every(round => round.mode === 'mock'), 'every round ran the mock reviewer');
  assert.ok(qa.rounds[0].issues.some(issue => issue.kind === 'subtitle_overflow' && issue.sceneId === 'item-6'), withScript ? 'round one caught the long line' : 'round one caught the long title');
  assert.deepEqual(qa.rounds.at(-1).issues, [], 'the last round passed');

  // The ending as the video shows it, from the mp4 rather than the QA stills.
  spawnSync('ffmpeg', ['-v', 'error', '-ss', '28', '-i', video, '-frames:v', '1', '-y', path.join(out, 'ending-from-video.jpg')]);
  const frames = path.join(scratch, 'runner', worker.jobId);
  const rounds = fs.readdirSync(frames).filter(name => name.startsWith('round-'));
  console.log(JSON.stringify({ worker: fake ? 'fake' : 'wrangler dev', jobId: worker.jobId, video: { ...info.streams[0], durationSec: Number(info.format.duration) }, costUsd: job.costUsd,
    rounds: qa.rounds.map(round => ({ round: round.round, mode: round.mode, issues: round.issues.map(issue => `${issue.kind}@${issue.sceneId}`) })), out, frames }, null, 2));

  const copyTo = process.env.PROMO_VERIFY_COPY_TO;
  if (copyTo) {
    fs.mkdirSync(copyTo, { recursive: true });
    for (const name of fs.readdirSync(out)) fs.copyFileSync(path.join(out, name), path.join(copyTo, name));
    for (const round of rounds) fs.cpSync(path.join(frames, round), path.join(copyTo, round), { recursive: true });
    console.log(`copied to ${copyTo}`);
  }
} finally {
  await worker.stop();
  fs.rmSync(path.join(scratch, 'state'), { recursive: true, force: true });
}

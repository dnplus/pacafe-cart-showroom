import path from 'node:path';
import { parseArgs } from 'node:util';
import { MAX_QA_ROUNDS, modelsFromEnv, redactor, runJob, type RunnerDeps } from './pipeline.ts';
import { remotionRenderer } from './render.ts';
import { workerClient } from './worker-client.ts';

const { values } = parseArgs({ options: {
  origin: { type: 'string', default: 'http://127.0.0.1:8877' }, once: { type: 'boolean', default: false },
  interval: { type: 'string', default: '15' }, rounds: { type: 'string', default: String(MAX_QA_ROUNDS) },
} });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const intervalSec = Number(values.interval), maxRounds = Number(values.rounds);
if (!(intervalSec > 0)) fail('--interval 是輪詢間隔秒數，必須大於 0。');
if (!Number.isInteger(maxRounds) || maxRounds < 1) fail('--rounds 必須是正整數。');
const token = process.env.CART_MCP_TOKEN || fail('未設定環境變數 CART_MCP_TOKEN（和 worker 的同一把）。');
const redact = redactor(process.env);
const log = (line: string) => console.log(redact(line));

let models: Pick<RunnerDeps, 'storyboarder' | 'reviewer' | 'tts'>;
try { models = modelsFromEnv(process.env, fetch, log); } catch { fail(`TTS_PROVIDER 只能是 none、elevenlabs 或 minimax。`); }
log(`配音：${models.tts.name}${models.tts.name === 'none' ? '（只出字幕）' : ''}`);

const workDir = path.resolve(process.env.RUNNER_WORK_DIR || path.join(import.meta.dirname, '../.local/runner'));
const renderer = remotionRenderer(workDir, log);
const deps: RunnerDeps = { ...models, worker: workerClient(values.origin.replace(/\/+$/, ''), token), renderer, workDir, maxRounds, redact, log };
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void renderer.close().finally(() => process.exit(130)); });

let exitCode = 0;
try {
  for (;;) {
    let claim = null;
    try { claim = await deps.worker.next(); } catch (error) {
      log(`拉 job 失敗：${error instanceof Error ? error.message : String(error)}`);
      if (values.once) { exitCode = 1; break; }
    }
    if (claim) exitCode = await runJob(claim, deps) === 'done' ? 0 : 1;
    else if (!values.once) log(`沒有排隊的 job，${intervalSec} 秒後再問。`);
    if (values.once) break;
    if (!claim) await new Promise(resolve => setTimeout(resolve, intervalSec * 1000));
  }
} finally {
  await renderer.close();
}
process.exit(exitCode);

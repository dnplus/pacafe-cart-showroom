import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { mcpClient } from './mcp-client.ts';
import { firstRequest, runTask } from './run.ts';
import { toFunctionTools } from './translate.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');

const { values } = parseArgs({ options: {
  'prompt-file': { type: 'string' }, model: { type: 'string', default: 'muse-spark-1.3' }, 'max-steps': { type: 'string', default: '60' }, 'dry-run': { type: 'boolean', default: false },
} });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const promptFile = values['prompt-file'] ?? fail('請用 --prompt-file 指定任務文字檔，例如 --prompt-file muse/demo-task.txt。');
const maxSteps = Number(values['max-steps']);
if (!Number.isInteger(maxSteps) || maxSteps < 1) fail('--max-steps 必須是正整數。');

const required = ['SHOWROOM_MCP_URL', 'CART_MCP_TOKEN', ...values['dry-run'] ? [] : ['META_API_KEY', 'META_API_BASE_URL']];
const missing = required.filter(name => !process.env[name]);
if (missing.length) fail(`未設定環境變數：${missing.join('、')}。`);
const env = (name: string) => process.env[name]!;

const skillsDir = path.join(repoRoot, '.agents/skills');
const instructions = fs.readdirSync(skillsDir).sort().map(skill => fs.readFileSync(path.join(skillsDir, skill, 'SKILL.md'), 'utf-8')).join('\n\n');
const prompt = fs.readFileSync(path.resolve(process.cwd(), promptFile), 'utf-8');

try {
  const mcp = mcpClient({ url: env('SHOWROOM_MCP_URL'), token: env('CART_MCP_TOKEN') });
  await mcp.initialize();
  if (values['dry-run']) {
    console.log(JSON.stringify(firstRequest({ prompt, instructions, model: values.model!, tools: toFunctionTools(await mcp.listTools()) }), null, 2));
  } else {
    const { text, steps, calls } = await runTask({ prompt, instructions, model: values.model!, apiBaseUrl: env('META_API_BASE_URL'), apiKey: env('META_API_KEY'), mcp, maxSteps });
    console.error(`完成：${steps} 次模型請求，${calls.length} 次工具呼叫（${calls.filter(call => call.isError).length} 次回報錯誤）。`);
    console.log(text);
  }
} catch (error) {
  const cause = error instanceof Error && error.cause instanceof Error ? `（${error.cause.message}）` : '';
  fail(`執行失敗：${error instanceof Error ? error.message : String(error)}${cause}`);
}

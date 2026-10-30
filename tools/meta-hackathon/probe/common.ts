import fs from 'node:fs';
import path from 'node:path';

// The API base, including its /v1 path, comes from the environment: ARS keeps it in src/meta/client.ts, which this
// repository does not carry, and the probes must not guess a host. Dry runs show a placeholder that resolves nowhere.
export const META_API_BASE_URL = process.env.META_API_BASE_URL ?? 'https://meta-api-base-url.invalid/v1';
// Prices from https://dev.meta.ai/docs/pricing-rate-limits, as listed in this directory's README.
export const PRICING = { SPARK_INPUT_PER_M: 1.25, SPARK_OUTPUT_PER_M: 4.25, SAM_IMAGE_PER_THOUSAND: 2.5, MUSE_IMAGE_PER_IMAGE: .01 } as const;

export const OUT_DIR = path.resolve(process.cwd(), 'tools/meta-hackathon/probe/out');

export function getApiKey(isDryRun: boolean): string {
  const key = process.env.META_API_KEY;
  if (!key) {
    if (isDryRun) {
      return 'DRY_RUN_MOCK_KEY';
    }
    throw new Error('未設定環境變數 META_API_KEY。請設定 META_API_KEY 或使用 --dry-run 參數執行模擬測試。');
  }
  if (!process.env.META_API_BASE_URL && !isDryRun) {
    throw new Error('未設定環境變數 META_API_BASE_URL（含 /v1 路徑）。請設定後再執行，或使用 --dry-run。');
  }
  return key;
}

export function ensureOutDir(): void {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
}

export function writeProbeOutput(filename: string, content: unknown): string {
  ensureOutDir();
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  return filePath;
}

export function isDryRun(): boolean {
  return process.argv.includes('--dry-run');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatCost(usd: number): string {
  if (usd < 0.001) {
    return `$${usd.toFixed(5)} USD`;
  }
  return `$${usd.toFixed(4)} USD`;
}

import {
  META_API_BASE_URL,
  PRICING,
  formatCost,
  formatDuration,
  getApiKey,
  isDryRun,
  writeProbeOutput,
} from './common.ts';

// 官方文件出處：https://dev.meta.ai/docs/models
// 官方 Images API 出處：https://dev.meta.ai/docs/images-generations
const MODEL_ID = 'muse-image-1.0';
const ENDPOINT = `${META_API_BASE_URL}/images/generations`;

export async function runMuseImage(): Promise<{
  model: string;
  endpoint: string;
  durationMs: number;
  estimatedCostUsd: number;
  status: string;
}> {
  const startTime = Date.now();
  const dryRun = isDryRun();
  const apiKey = getApiKey(dryRun);

  // 測試包含繁體中文字的縮圖提示詞
  const prompt =
    '16:9 介紹片封面縮圖：溫暖奶油色調的等角小房間，櫃台後方貨架擺滿彩色商品盒，畫面帶有清晰繁體中文字樣「小屋購物車」與副標題「Muse 採買時記下的東西」，風格乾淨可愛。';

  const requestBody = {
    model: MODEL_ID,
    prompt,
    n: 1,
    size: '1920x1080',
    response_format: 'url',
  };

  console.log(`\n========================================`);
  console.log(`[Probe 4] Muse Image 含繁中文字縮圖生成實測`);
  console.log(`- 模型：${MODEL_ID}`);
  console.log(`- 端點：${ENDPOINT}`);
  console.log(`- 模式：${dryRun ? 'DRY-RUN (模擬測試)' : 'LIVE API'}`);
  console.log(`- 提示詞：${prompt}`);

  let resultData: unknown;

  if (dryRun) {
    console.log(`- 請求 Headers: Authorization: Bearer [REDACTED], Content-Type: application/json`);
    console.log(`- 請求 Payload:`);
    console.log(JSON.stringify(requestBody, null, 2));

    resultData = {
      mock: true,
      model: MODEL_ID,
      created: Math.floor(Date.now() / 1000),
      data: [
        {
          url: 'https://api.meta.ai/v1/files/mock-generated-thumbnail-1920x1080.png',
          revised_prompt: prompt,
        },
      ],
    };
  } else {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Muse Image API 請求失敗 (${res.status}): ${errText}`);
    }

    resultData = await res.json();
  }

  const durationMs = Date.now() - startTime;
  // 定價：每張圖 $0.01 USD
  const totalCostUsd = PRICING.MUSE_IMAGE_PER_IMAGE;

  const outFile = writeProbeOutput('muse-image.json', {
    probe: 'muse-image',
    model: MODEL_ID,
    endpoint: ENDPOINT,
    dryRun,
    prompt,
    durationMs,
    costUsd: totalCostUsd,
    response: resultData,
  });

  console.log(`- 執行結果：${dryRun ? '成功 (Mock)' : '成功'}`);
  console.log(`- 耗時：${formatDuration(durationMs)}`);
  console.log(`- 估計花費：${formatCost(totalCostUsd)} (生成 1 張，每張 $0.01)`);
  console.log(`- 產物已寫入：${outFile}`);

  return {
    model: MODEL_ID,
    endpoint: ENDPOINT,
    durationMs,
    estimatedCostUsd: totalCostUsd,
    status: 'ok',
  };
}

if (process.argv[1]?.endsWith('muse-image.ts') || process.argv[1]?.endsWith('muse-image.js')) {
  runMuseImage().catch((err) => {
    console.error(`[錯誤] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

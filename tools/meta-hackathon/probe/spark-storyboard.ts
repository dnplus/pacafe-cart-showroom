import fs from 'node:fs';
import path from 'node:path';
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
// 官方 Responses / Chat API 出處：https://dev.meta.ai/docs/responses-api
const MODEL_ID = 'muse-spark-1.3';
const ENDPOINT = `${META_API_BASE_URL}/chat/completions`;

export async function runSparkStoryboard(): Promise<{
  model: string;
  endpoint: string;
  durationMs: number;
  estimatedCostUsd: number;
  status: string;
}> {
  const startTime = Date.now();
  const dryRun = isDryRun();
  const apiKey = getApiKey(dryRun);

  const samplePath = path.resolve(import.meta.dirname, 'samples/cart-promo-script.txt');
  const scriptContent = fs.readFileSync(samplePath, 'utf-8');

  const requestBody = {
    model: MODEL_ID,
    messages: [
      {
        role: 'system',
        content:
          '你是一位專業的台灣繁體中文短影音分鏡師。請將輸入的口播稿件轉換為結構化分鏡 JSON，格式必須包含 scenes 陣列，每個 scene 包含 id, title 與 beats 陣列；每個 beat 包含 id, narration, 以及 board（1~3 句視覺分鏡意圖）。',
      },
      {
        role: 'user',
        content: `口播文稿：\n${scriptContent}`,
      },
    ],
    response_format: {
      type: 'json_object',
    },
    temperature: 0.2,
  };

  console.log(`\n========================================`);
  console.log(`[Probe 1] Muse Spark 稿件轉分鏡實測`);
  console.log(`- 模型：${MODEL_ID}`);
  console.log(`- 端點：${ENDPOINT}`);
  console.log(`- 模式：${dryRun ? 'DRY-RUN (模擬測試)' : 'LIVE API'}`);
  console.log(`- 樣本字數：${scriptContent.length} 字`);

  let resultData: unknown;
  let estimatedInputTokens = Math.ceil(scriptContent.length * 1.5) + 300;
  let estimatedOutputTokens = 800;

  if (dryRun) {
    console.log(`- 請求 Headers: Authorization: Bearer [REDACTED], Content-Type: application/json`);
    console.log(`- 請求 Payload 預覽:`);
    console.log(JSON.stringify(requestBody, null, 2).slice(0, 300) + '...\n');

    resultData = {
      mock: true,
      model: MODEL_ID,
      scenes: [
        {
          id: 'opening',
          title: '小屋購物車開場',
          beats: [
            {
              id: 'beat_01',
              narration: '這是我的小屋購物車。架上這五樣，是我的 Muse 這週採買時記下的東西。',
              board: '鏡頭從櫃台推向貨架，五件商品依序亮起，右下角標註「Muse 採買時記下的東西」。',
            },
            {
              id: 'beat_02',
              narration: '收銀機上寫著總額新台幣七千四百六十元。這裡沒有結帳，採買是我的 Muse 做的，小屋只負責擺出來。',
              board: '收銀機螢幕特寫顯示 NT$ 7,460，字卡註明「沒有結帳，也不是 Muse 購物的整合」。',
            },
          ],
        },
      ],
      usage: {
        prompt_tokens: estimatedInputTokens,
        completion_tokens: estimatedOutputTokens,
        total_tokens: estimatedInputTokens + estimatedOutputTokens,
      },
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
      throw new Error(`API 請求失敗 (${res.status}): ${errText}`);
    }

    resultData = await res.json();
    const usage = (resultData as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    if (usage) {
      estimatedInputTokens = usage.prompt_tokens ?? estimatedInputTokens;
      estimatedOutputTokens = usage.completion_tokens ?? estimatedOutputTokens;
    }
  }

  const durationMs = Date.now() - startTime;
  const inputCost = (estimatedInputTokens / 1_000_000) * PRICING.SPARK_INPUT_PER_M;
  const outputCost = (estimatedOutputTokens / 1_000_000) * PRICING.SPARK_OUTPUT_PER_M;
  const totalCostUsd = inputCost + outputCost;

  const outFile = writeProbeOutput('spark-storyboard.json', {
    probe: 'spark-storyboard',
    model: MODEL_ID,
    endpoint: ENDPOINT,
    dryRun,
    tokens: {
      input: estimatedInputTokens,
      output: estimatedOutputTokens,
    },
    durationMs,
    costUsd: totalCostUsd,
    response: resultData,
  });

  console.log(`- 執行結果：${dryRun ? '成功 (Mock)' : '成功'}`);
  console.log(`- 耗時：${formatDuration(durationMs)}`);
  console.log(`- 估計花費：${formatCost(totalCostUsd)} (輸入 ${estimatedInputTokens} tok, 輸出 ${estimatedOutputTokens} tok)`);
  console.log(`- 產物已寫入：${outFile}`);

  return {
    model: MODEL_ID,
    endpoint: ENDPOINT,
    durationMs,
    estimatedCostUsd: totalCostUsd,
    status: 'ok',
  };
}

if (process.argv[1]?.endsWith('spark-storyboard.ts') || process.argv[1]?.endsWith('spark-storyboard.js')) {
  runSparkStoryboard().catch((err) => {
    console.error(`[錯誤] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

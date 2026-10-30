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
// SAM 3.1 影像分割與追蹤模型
const MODEL_ID = 'sam-3.1';
const ENDPOINT = `${META_API_BASE_URL}/responses`;

export async function runSamSegmentation(): Promise<{
  model: string;
  endpoint: string;
  durationMs: number;
  estimatedCostUsd: number;
  status: string;
}> {
  const startTime = Date.now();
  const dryRun = isDryRun();
  const apiKey = getApiKey(dryRun);

  const sampleImagePath = path.resolve(import.meta.dirname, '../../../docs/screenshots/desktop.png');
  if (!fs.existsSync(sampleImagePath)) {
    throw new Error(`找不到樣本截圖：${sampleImagePath}`);
  }

  const imageBuffer = fs.readFileSync(sampleImagePath);
  const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const prompts = [
    { lang: 'en', prompt: 'product boxes on the shelf', desc: '英文名詞提示詞' },
    { lang: 'zh', prompt: '貨架上的商品盒', desc: '繁體中文名詞提示詞' },
  ];

  console.log(`\n========================================`);
  console.log(`[Probe 3] SAM 3.1 中英文提示對同一張截圖分割實測`);
  console.log(`- 模型：${MODEL_ID}`);
  console.log(`- 端點：${ENDPOINT}`);
  console.log(`- 模式：${dryRun ? 'DRY-RUN (模擬測試)' : 'LIVE API'}`);
  console.log(`- 樣本截圖：${sampleImagePath} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

  const results: Array<{
    lang: string;
    prompt: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
    confidence?: number;
    maskData?: string;
  }> = [];

  for (const item of prompts) {
    console.log(`\n  測試提示詞 [${item.lang}]： "${item.prompt}" (${item.desc})`);

    const requestBody = {
      model: MODEL_ID,
      input: [
        {
          type: 'image',
          image_url: base64Image.slice(0, 60) + '...[REDACTED_BASE64]',
        },
        {
          type: 'text',
          text: item.prompt,
        },
      ],
    };

    if (dryRun) {
      console.log(`  - 請求 Headers: Authorization: Bearer [REDACTED], Content-Type: application/json`);
      console.log(`  - 請求 Payload (文字部分): ${JSON.stringify(requestBody.input[1])}`);

      results.push({
        lang: item.lang,
        prompt: item.prompt,
        boundingBox: {
          x: 48,
          y: 120,
          width: 860,
          height: 480,
        },
        confidence: item.lang === 'en' ? 0.94 : 0.88,
        maskData: 'rle_encoded_mask_mock_data',
      });
    } else {
      const realRequestBody = {
        model: MODEL_ID,
        input: [
          {
            type: 'image',
            image_url: base64Image,
          },
          {
            type: 'text',
            text: item.prompt,
          },
        ],
      };

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(realRequestBody),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`SAM API 請求失敗 (${res.status}): ${errText}`);
      }

      const resData = (await res.json()) as {
        bounding_box?: { x: number; y: number; width: number; height: number };
        confidence?: number;
      };

      results.push({
        lang: item.lang,
        prompt: item.prompt,
        boundingBox: resData.bounding_box,
        confidence: resData.confidence,
      });
    }
  }

  const durationMs = Date.now() - startTime;
  // SAM 定價：每 1,000 張圖 $2.50，此處兩次提示詞呼叫
  const totalCostUsd = (prompts.length / 1000) * PRICING.SAM_IMAGE_PER_THOUSAND;

  const outFile = writeProbeOutput('sam-segmentation.json', {
    probe: 'sam-segmentation',
    model: MODEL_ID,
    endpoint: ENDPOINT,
    dryRun,
    sampleImage: path.basename(sampleImagePath),
    promptsTested: results,
    durationMs,
    costUsd: totalCostUsd,
  });

  console.log(`\n- 執行結果：${dryRun ? '成功 (Mock 雙提示比對)' : '成功'}`);
  console.log(`- 耗時：${formatDuration(durationMs)}`);
  console.log(`- 估計花費：${formatCost(totalCostUsd)} (${prompts.length} 次查詢，每千張 $2.50)`);
  console.log(`- 產物已寫入：${outFile}`);

  return {
    model: MODEL_ID,
    endpoint: ENDPOINT,
    durationMs,
    estimatedCostUsd: totalCostUsd,
    status: 'ok',
  };
}

if (process.argv[1]?.endsWith('sam-segmentation.ts') || process.argv[1]?.endsWith('sam-segmentation.js')) {
  runSamSegmentation().catch((err) => {
    console.error(`[錯誤] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

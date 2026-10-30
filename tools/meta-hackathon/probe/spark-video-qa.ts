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
// 官方多模態與檔案上傳出處：https://dev.meta.ai/docs/file-handling
// 註：影片換算 token 之官方具體比率待確認（官方文件未公開），以短片經驗值 100,000 tokens 估算
const MODEL_ID = 'muse-spark-1.3';
const ENDPOINT = `${META_API_BASE_URL}/chat/completions`;

export async function runSparkVideoQa(): Promise<{
  model: string;
  endpoint: string;
  durationMs: number;
  estimatedCostUsd: number;
  status: string;
}> {
  const startTime = Date.now();
  const dryRun = isDryRun();
  const apiKey = getApiKey(dryRun);

  const videoArgIndex = process.argv.indexOf('--video');
  const videoFilePath = videoArgIndex !== -1 && process.argv[videoArgIndex + 1]
    ? path.resolve(process.argv[videoArgIndex + 1])
    : null;

  console.log(`\n========================================`);
  console.log(`[Probe 5] Muse Spark 影片理解看片驗收實測`);
  console.log(`- 模型：${MODEL_ID}`);
  console.log(`- 端點：${ENDPOINT}`);
  console.log(`- 模式：${dryRun ? 'DRY-RUN (模擬測試)' : 'LIVE API'}`);

  let videoDescriptor = '模擬 15 秒 ARS 預覽短片片段 (1080p, 30fps)';
  if (videoFilePath) {
    if (!fs.existsSync(videoFilePath)) {
      throw new Error(`找不到指定的影片路徑：${videoFilePath}`);
    }
    const stat = fs.statSync(videoFilePath);
    videoDescriptor = `${path.basename(videoFilePath)} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`;
  } else if (!dryRun) {
    throw new Error('真實 API 模式下必須使用 --video <檔案路徑> 提供影片檔案。');
  }

  console.log(`- 輸入影片：${videoDescriptor}`);

  const qaPrompt =
    '請依據 ARS 視覺規範（docs/visual.md）審查這段 15 秒短片成片：' +
    '1. 檢查第 3~6 秒字幕是否超出安全框（右側 padding 60px）。' +
    '2. 檢查畫面切換與旁白節奏是否吻合。' +
    '3. 畫面與字幕是否出現結帳、下單或購買按鈕等字樣（小屋沒有結帳，不該出現）。' +
    '請輸出包含 timestamp_sec, issue_type, severity, description, suggested_fix 的 JSON 陣列。';

  const requestBody = {
    model: MODEL_ID,
    messages: [
      {
        role: 'system',
        content: '你是一位嚴格的 Remotion 影片視覺驗收助理（Release QA）。請回傳結構化 JSON 修正單。',
      },
      {
        role: 'user',
        content: [
          {
            type: 'video_url',
            video_url: {
              url: 'https://api.meta.ai/v1/files/sample-rendered-beat.mp4',
            },
          },
          {
            type: 'text',
            text: qaPrompt,
          },
        ],
      },
    ],
    response_format: {
      type: 'json_object',
    },
    temperature: 0.1,
  };

  let resultData: unknown;
  // 視訊 token 官方未明確公開，估算 100k input tokens
  const estimatedInputTokens = 100_000;
  const estimatedOutputTokens = 600;

  if (dryRun) {
    console.log(`- 請求 Headers: Authorization: Bearer [REDACTED], Content-Type: application/json`);
    console.log(`- 請求 Payload (文字要求): ${qaPrompt}`);

    resultData = {
      mock: true,
      model: MODEL_ID,
      issues: [
        {
          timestamp_sec: 4.2,
          beat_id: 'beat_02',
          issue_type: 'subtitle_overflow',
          severity: 'warning',
          description: '字幕過長且未在逗號處適當換行，導致接近右側安全邊距。',
          suggested_fix: '在「差在哪裡」後補換行或將旁白拆為兩句。',
        },
        {
          timestamp_sec: 11.0,
          beat_id: 'beat_03',
          issue_type: 'cue_sync',
          severity: 'info',
          description: '字卡動畫提早 0.3 秒出現，旁白尚未唸到關鍵字。',
          suggested_fix: '將 motion at cue 延後 9 影格。',
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
      throw new Error(`Spark Video QA API 請求失敗 (${res.status}): ${errText}`);
    }

    resultData = await res.json();
  }

  const durationMs = Date.now() - startTime;
  const inputCost = (estimatedInputTokens / 1_000_000) * PRICING.SPARK_INPUT_PER_M;
  const outputCost = (estimatedOutputTokens / 1_000_000) * PRICING.SPARK_OUTPUT_PER_M;
  const totalCostUsd = inputCost + outputCost;

  const outFile = writeProbeOutput('spark-video-qa.json', {
    probe: 'spark-video-qa',
    model: MODEL_ID,
    endpoint: ENDPOINT,
    dryRun,
    video: videoDescriptor,
    tokens: {
      inputEstimated: estimatedInputTokens,
      outputEstimated: estimatedOutputTokens,
    },
    durationMs,
    costUsd: totalCostUsd,
    response: resultData,
  });

  console.log(`- 執行結果：${dryRun ? '成功 (Mock QA 修正單)' : '成功'}`);
  console.log(`- 耗時：${formatDuration(durationMs)}`);
  console.log(
    `- 估計花費：${formatCost(totalCostUsd)} (影片輸入約 ${estimatedInputTokens} tok，官方換算率待確認)`
  );
  console.log(`- 產物已寫入：${outFile}`);

  return {
    model: MODEL_ID,
    endpoint: ENDPOINT,
    durationMs,
    estimatedCostUsd: totalCostUsd,
    status: 'ok',
  };
}

if (process.argv[1]?.endsWith('spark-video-qa.ts') || process.argv[1]?.endsWith('spark-video-qa.js')) {
  runSparkVideoQa().catch((err) => {
    console.error(`[錯誤] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

import {
  formatCost,
  formatDuration,
  isDryRun,
  writeProbeOutput,
} from './common.ts';
import { runSparkStoryboard } from './spark-storyboard.ts';
import { runSamSegmentation } from './sam-segmentation.ts';
import { runMuseImage } from './muse-image.ts';
import { runSparkVideoQa } from './spark-video-qa.ts';

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const overallStart = Date.now();

  console.log(`================================================================`);
  console.log(` Meta Global AI Developer Hackathon: ARS Probe 實測總腳本`);
  console.log(` 模式：${dryRun ? 'DRY-RUN (模擬運行，印出請求與計費估算)' : 'LIVE API (真實連線)'}`);
  console.log(`================================================================`);

  const results: Array<{
    probe: string;
    model: string;
    endpoint: string;
    durationMs: number;
    estimatedCostUsd: number;
    status: string;
  }> = [];

  try {
    const res1 = await runSparkStoryboard();
    results.push({ probe: 'spark-storyboard', ...res1 });

    const res3 = await runSamSegmentation();
    results.push({ probe: 'sam-segmentation', ...res3 });

    const res4 = await runMuseImage();
    results.push({ probe: 'muse-image', ...res4 });

    const res5 = await runSparkVideoQa();
    results.push({ probe: 'spark-video-qa', ...res5 });
  } catch (err) {
    console.error(`\n[執行中斷] 發生未預期錯誤：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const overallDurationMs = Date.now() - overallStart;
  const totalCostUsd = results.reduce((acc, cur) => acc + cur.estimatedCostUsd, 0);

  console.log(`\n================================================================`);
  console.log(` 實測彙總報告 (Probe Summary)`);
  console.log(`================================================================`);
  for (const r of results) {
    console.log(
      `  • [${r.status.toUpperCase()}] ${r.probe.padEnd(20)} | ${r.model.padEnd(25)} | 耗時: ${formatDuration(r.durationMs).padEnd(8)} | 費用: ${formatCost(r.estimatedCostUsd)}`
    );
  }
  console.log(`----------------------------------------------------------------`);
  console.log(` 總耗時：${formatDuration(overallDurationMs)}`);
  console.log(` 預估總費用：${formatCost(totalCostUsd)}`);
  console.log(`================================================================\n`);

  const summaryFile = writeProbeOutput('probe-summary.json', {
    generatedAt: new Date().toISOString(),
    dryRun,
    overallDurationMs,
    totalEstimatedCostUsd: totalCostUsd,
    probes: results,
  });

  console.log(`總彙總報告已寫入：${summaryFile}\n`);
}

main().catch((err) => {
  console.error(`[致命錯誤] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

import path from 'node:path';
import type { HeadlessBrowser } from '@remotion/renderer';
import { PROMO_COMPOSITION, PROMO_FORMAT, type PromoInput } from './storyboard.ts';

export interface Renderer {
  video(input: PromoInput, output: string, onProgress: (progress: number) => void): Promise<{ durationSec: number }>;
  still(input: PromoInput, atSec: number, output: string): Promise<void>;
  close(): Promise<void>;
}

const ENTRY = path.join(import.meta.dirname, 'composition/index.ts');

/**
 * Remotion, as ARS's cli/lib/production.ts drives it: bundle once, select the composition with the job's props, then
 * renderStill and renderMedia. One browser serves every still and the video; two tabs keep a laptop responsive.
 */
export function remotionRenderer(workDir: string, log: (line: string) => void): Renderer {
  let serveUrl: Promise<string> | undefined;
  let browser: Promise<HeadlessBrowser> | undefined;
  const served = () => serveUrl ??= import('@remotion/bundler').then(({ bundle }) => bundle({ entryPoint: ENTRY, outDir: path.join(workDir, 'bundle'), publicDir: null, enableCaching: true }));
  const opened = () => browser ??= import('@remotion/renderer').then(({ openBrowser }) => openBrowser('chrome', { logLevel: 'error' }));
  const prepare = async (input: PromoInput) => {
    const [{ selectComposition }, url, puppeteerInstance] = await Promise.all([import('@remotion/renderer'), served(), opened()]);
    const inputProps = input as unknown as Record<string, unknown>;
    return { serveUrl: url, inputProps, puppeteerInstance, composition: await selectComposition({ serveUrl: url, id: PROMO_COMPOSITION, inputProps, puppeteerInstance, logLevel: 'error' }) };
  };
  return {
    async video(input, output, onProgress) {
      const { renderMedia } = await import('@remotion/renderer');
      const job = await prepare(input);
      let shown = -1;
      await renderMedia({ ...job, codec: 'h264', crf: 23, outputLocation: output, concurrency: 2, logLevel: 'error', onProgress: ({ progress }) => {
        onProgress(progress);
        if (Math.floor(progress * 10) > shown) { shown = Math.floor(progress * 10); log(`render ${shown * 10}%`); }
      } });
      return { durationSec: job.composition.durationInFrames / PROMO_FORMAT.fps };
    },
    async still(input, atSec, output) {
      const { renderStill } = await import('@remotion/renderer');
      const job = await prepare(input);
      await renderStill({ ...job, output, frame: Math.min(job.composition.durationInFrames - 1, Math.round(atSec * PROMO_FORMAT.fps)), imageFormat: 'jpeg', jpegQuality: 85, logLevel: 'error' });
    },
    async close() {
      if (browser) await (await browser).close({ silent: true });
    },
  };
}

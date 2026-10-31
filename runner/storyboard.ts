import { z } from 'zod';
import { formatTwd, webUrl } from '../shared/cart.ts';
import type { PromoJob } from '../shared/promo.ts';
import { ENDING_SECONDS, itemSceneCount, OPENING_SECONDS, PRICE_PATTERN } from '../shared/script.ts';
import { priceModes, type PriceRange, type ShareView } from '../shared/share.ts';

/** 720p and two render tabs: the runner works on a laptop next to wrangler dev. */
export const PROMO_FORMAT = { width: 1280, height: 720, fps: 30 } as const;
export const PROMO_COMPOSITION = 'promo';

/** The ending draws these from here, not from the storyboard, so neither Spark nor a fix can drop them. */
export const DISCLAIMER = ['Not affiliated with, endorsed by, or sponsored by Meta.', "pacafe-cart-showroom uses Meta's Muse models via the Meta Model API."] as const;

/** Subtitles draw on one line each, unwrapped, at this size; a line wider than the safe width spills past the margins. */
export const SUBTITLE = { fontSize: 44, maxWidthEm: 24, linesPerPage: 2 } as const;

/** Width in em of a line in a CJK UI font: full-width characters take 1, Latin letters, digits and spaces about 0.6. */
export const textWidthEm = (text: string) => [...text].reduce((sum, char) => sum + (/[\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.6), 0);
export const charCount = (lines: readonly string[]) => lines.reduce((sum, line) => sum + [...line.replace(/\s/g, '')].length, 0);

const OPENING_SEC = OPENING_SECONDS, ENDING_SEC = ENDING_SECONDS;
export { itemSceneCount, PRICE_PATTERN };

const line = z.string().trim().min(1).max(200);
const timing = { id: z.string().min(1), startSec: z.number().nonnegative(), endSec: z.number().positive(), subtitle: z.array(line).min(1) };
export const sceneSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('opening'), ...timing, nickname: z.string(), count: z.number().int().nonnegative(), total: z.string().nullable() }),
  z.strictObject({ kind: z.literal('item'), ...timing, title: z.string(), qty: z.number().int().positive(), price: z.string().nullable(), image: webUrl.nullable() }),
  z.strictObject({ kind: z.literal('ending'), ...timing, more: z.number().int().nonnegative() }),
]);
export type Scene = z.infer<typeof sceneSchema>;

/** Scenes back to back from 0 to durationSec: opening, one per item shown, ending. Prices are already in the view's mode. */
export const storyboardSchema = z.strictObject({ durationSec: z.number().positive(), priceMode: z.enum(priceModes), scenes: z.array(sceneSchema).min(2) })
  .refine(({ scenes, durationSec }) => scenes[0].startSec === 0 && Math.abs(scenes.at(-1)!.endSec - durationSec) < 1e-6 && scenes.every((scene, i) => scene.endSec > scene.startSec && (i === 0 || Math.abs(scene.startSec - scenes[i - 1].endSec) < 1e-6)), 'scenes must tile 0..durationSec')
  .refine(({ scenes }) => scenes[0].kind === 'opening' && scenes.at(-1)!.kind === 'ending', 'opening first, ending last');
export type Storyboard = z.infer<typeof storyboardSchema>;

/** A scene's voice as a data URL, which Remotion's renderer reads like any other asset; no public directory to keep in step. */
export type VoiceClip = { sceneId: string; src: string; durationSec: number };
/** What the composition draws: the storyboard and, when a voice provider ran, one clip per scene. */
export type PromoInput = { storyboard: Storyboard; voice: VoiceClip[] };

const frame = (sec: number) => Math.round(sec * PROMO_FORMAT.fps) / PROMO_FORMAT.fps;
/** The scenes laid end to end with these durations, cut on frame boundaries; the last one ends exactly at `total`. */
export function retime<S extends Scene>(scenes: readonly S[], durations: readonly number[], total: number): S[] {
  let at = 0;
  return scenes.map((scene, i) => {
    const startSec = frame(at); at += durations[i];
    return { ...scene, startSec, endSec: i === scenes.length - 1 ? total : frame(at) };
  });
}

const rangeText = ({ minTwd, maxTwd }: PriceRange) => maxTwd === null ? `${formatTwd(minTwd)} 以上` : `${formatTwd(minTwd)}–${formatTwd(maxTwd).replace('NT$ ', '')}`;

/** What the video may say about each item and the total, in the owner's share mode: hidden says nothing. */
export function viewPrices(view: ShareView): { total: string | null; items: (string | null)[] } {
  switch (view.mode) {
    case 'hidden': return { total: null, items: view.items.map(() => null) };
    case 'range': return { total: view.totalRange && rangeText(view.totalRange), items: view.items.map(item => item.priceRange && rangeText(item.priceRange)) };
    case 'exact': return { total: view.totalTwd === null ? null : formatTwd(view.totalTwd), items: view.items.map(item => item.priceTwd === null ? null : formatTwd(item.priceTwd)) };
  }
}

/** The screen of every scene, with empty subtitles and evenly split item time; a storyboarder only writes the words. */
export function sceneFrames(view: ShareView, job: Pick<PromoJob, 'durationSec'>): Scene[] {
  const prices = viewPrices(view), shown = view.items.slice(0, itemSceneCount(view.items.length, job.durationSec));
  const scenes: Scene[] = [
    { kind: 'opening', id: 'opening', startSec: 0, endSec: 0, subtitle: [], nickname: view.nickname, count: view.items.length, total: prices.total },
    ...shown.map((item, i): Scene => ({ kind: 'item', id: `item-${i + 1}`, startSec: 0, endSec: 0, subtitle: [], title: item.title, qty: item.qty, price: prices.items[i], image: item.imageUrl })),
    { kind: 'ending', id: 'ending', startSec: 0, endSec: 0, subtitle: [], more: view.items.length - shown.length },
  ];
  const itemSec = shown.length ? (job.durationSec - OPENING_SEC - ENDING_SEC) / shown.length : 0;
  const durations = scenes.map(scene => scene.kind === 'opening' ? (shown.length ? OPENING_SEC : job.durationSec - ENDING_SEC) : scene.kind === 'ending' ? ENDING_SEC : itemSec);
  return retime(scenes, durations, job.durationSec);
}

/** The owner hosts, so the lines are theirs: a sentence per line from the view alone. The cards already show prices and the total, so the words stay short; fitting lines to the screen is the QA loop's job. */
export function fallbackSubtitle(scene: Scene, mode: ShareView['mode']): string[] {
  switch (scene.kind) {
    case 'opening': return [`歡迎來到${scene.nickname}的小屋購物車！`, `架上 ${scene.count} 件，都是 Muse 幫我採買時記下的。`];
    case 'item': return [`「${scene.title}」${scene.qty > 1 ? ` ×${scene.qty}` : ''}${scene.price ? `，${mode === 'range' ? '大約 ' : ''}${scene.price}` : ''}。`];
    case 'ending': return [`今天就介紹到這裡${scene.more ? `，另外 ${scene.more} 件在小屋等你` : ''}。`, '想看全部，就來小屋的貨架逛逛吧！'];
  }
}

export const withSubtitles = (view: ShareView, scenes: Scene[], subtitles: (scene: Scene) => string[]): Storyboard =>
  storyboardSchema.parse({ durationSec: scenes.at(-1)!.endSec, priceMode: view.mode, scenes: scenes.map(scene => ({ ...scene, subtitle: subtitles(scene) })) });

export const fallbackStoryboard = (view: ShareView, job: Pick<PromoJob, 'durationSec'>): Storyboard =>
  withSubtitles(view, sceneFrames(view, job), scene => fallbackSubtitle(scene, view.mode));

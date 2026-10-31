import { z } from 'zod';
import { formatTwd, webUrl } from '../shared/cart.ts';
import { PROMO_LANGUAGES, type PromoJob, type PromoLanguage } from '../shared/promo.ts';
import { DEFAULT_NICKNAME, priceModes, type PriceRange, type ShareView } from '../shared/share.ts';

/** 720p and two render tabs: the runner works on a laptop next to wrangler dev. */
export const PROMO_FORMAT = { width: 1280, height: 720, fps: 30 } as const;
export const PROMO_COMPOSITION = 'promo';

/** The ending draws these from here, not from the storyboard, so neither Spark nor a fix can drop them. */
export const DISCLAIMER = ['Not affiliated with, endorsed by, or sponsored by Meta.', "pacafe-cart-showroom uses Meta's Muse models via the Meta Model API."] as const;

/** Subtitles draw on one line each, unwrapped, at this size; a line wider than the safe width spills past the margins. */
export const SUBTITLE = { fontSize: 44, maxWidthEm: 24, linesPerPage: 2 } as const;

/** Width in em of a line in a CJK UI font: full-width characters take 1, Latin letters, digits and spaces about 0.6. */
export const textWidthEm = (text: string) => [...text].reduce((sum, char) => sum + (/[\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.6), 0);
/** Reading load: a full-width character counts 1, any other non-space character half, so English paces like Chinese. */
export const charCount = (lines: readonly string[]) => lines.reduce((sum, line) => sum + textWidthEm(line.replace(/\s/g, '')) / 0.6 * 0.5, 0);

const OPENING_SEC = 4, ENDING_SEC = 5, MIN_ITEM_SEC = 2;
/** Up to 8 items get a scene of at least two seconds each; the ending counts the rest. */
export const itemSceneCount = (items: number, durationSec: number) => Math.min(items, 8, Math.floor((durationSec - OPENING_SEC - ENDING_SEC) / MIN_ITEM_SEC));

const line = z.string().trim().min(1).max(200);
const timing = { id: z.string().min(1), startSec: z.number().nonnegative(), endSec: z.number().positive(), subtitle: z.array(line).min(1) };
export const sceneSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('opening'), ...timing, nickname: z.string(), count: z.number().int().nonnegative(), total: z.string().nullable() }),
  z.strictObject({ kind: z.literal('item'), ...timing, title: z.string(), qty: z.number().int().positive(), price: z.string().nullable(), image: webUrl.nullable() }),
  z.strictObject({ kind: z.literal('ending'), ...timing, more: z.number().int().nonnegative() }),
]);
export type Scene = z.infer<typeof sceneSchema>;

/** Scenes back to back from 0 to durationSec: opening, one per item shown, ending. Prices are already in the view's mode. */
export const storyboardSchema = z.strictObject({ durationSec: z.number().positive(), priceMode: z.enum(priceModes), language: z.enum(PROMO_LANGUAGES).default('zh-TW'), scenes: z.array(sceneSchema).min(2) })
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

/** Every word the video draws or says that is not the owner's own data, per language. */
export const PROMO_WORDS = {
  'zh-TW': {
    brand: '小屋購物車', title: (name: string) => `${name}的小屋購物車`, shelf: (count: number) => `架上 ${count} 件，Muse 採買時記下的東西`,
    total: (total: string) => `總額 ${total}`, nth: (n: number) => `第 ${n} 件`, orMore: (price: string) => `${price} 以上`,
    opening: (name: string, count: number) => [`歡迎來到${name}的小屋購物車！`, `架上 ${count} 件，都是 Muse 幫我採買時記下的。`],
    item: (title: string, qty: number, price: string | null, about: boolean) => [`「${title}」${qty > 1 ? ` ×${qty}` : ''}${price ? `，${about ? '大約 ' : ''}${price}` : ''}。`],
    ending: (more: number) => [`今天就介紹到這裡${more ? `，另外 ${more} 件在小屋等你` : ''}。`, '想看全部，就來小屋的貨架逛逛吧！'],
  },
  en: {
    brand: 'Cart Showroom', title: (name: string) => `${name}'s Cart Showroom`, shelf: (count: number) => `${count} ${count === 1 ? 'thing' : 'things'} Muse noted while shopping`,
    total: (total: string) => `Total ${total}`, nth: (n: number) => `No. ${n}`, orMore: (price: string) => `${price}+`,
    opening: (name: string, count: number) => [`Welcome to ${name === 'Owner' ? 'my' : `${name}'s`} Cart Showroom!`, `${count} ${count === 1 ? 'thing' : 'things'} on the shelf, all noted by Muse.`],
    item: (title: string, qty: number, price: string | null, about: boolean) => [`${title}${qty > 1 ? ` ×${qty}` : ''}${price ? `, ${about ? 'about ' : ''}${price}` : ''}.`],
    ending: (more: number) => [`That's all for today${more ? `, ${more} more ${more === 1 ? 'waits' : 'wait'} in the showroom` : ''}.`, 'Come browse the whole shelf!'],
  },
} as const satisfies Record<PromoLanguage, unknown>;

/** The owner's name as the video shows it: the default nickname reads as "Owner" in English. */
export const promoNickname = (nickname: string, language: PromoLanguage) => language === 'en' && nickname === DEFAULT_NICKNAME ? 'Owner' : nickname;

const rangeText = (language: PromoLanguage) => ({ minTwd, maxTwd }: PriceRange) => maxTwd === null ? PROMO_WORDS[language].orMore(formatTwd(minTwd)) : `${formatTwd(minTwd)}–${formatTwd(maxTwd).replace('NT$ ', '')}`;

/** What the video may say about each item and the total, in the owner's share mode: hidden says nothing. */
export function viewPrices(view: ShareView, language: PromoLanguage = 'zh-TW'): { total: string | null; items: (string | null)[] } {
  const range = rangeText(language);
  switch (view.mode) {
    case 'hidden': return { total: null, items: view.items.map(() => null) };
    case 'range': return { total: view.totalRange && range(view.totalRange), items: view.items.map(item => item.priceRange && range(item.priceRange)) };
    case 'exact': return { total: view.totalTwd === null ? null : formatTwd(view.totalTwd), items: view.items.map(item => item.priceTwd === null ? null : formatTwd(item.priceTwd)) };
  }
}

/** The screen of every scene, with empty subtitles and evenly split item time; a storyboarder only writes the words. */
type JobShape = Pick<PromoJob, 'durationSec'> & { language?: PromoLanguage };
export function sceneFrames(view: ShareView, job: JobShape): Scene[] {
  const language = job.language ?? 'zh-TW', prices = viewPrices(view, language), shown = view.items.slice(0, itemSceneCount(view.items.length, job.durationSec));
  const scenes: Scene[] = [
    { kind: 'opening', id: 'opening', startSec: 0, endSec: 0, subtitle: [], nickname: promoNickname(view.nickname, language), count: view.items.length, total: prices.total },
    ...shown.map((item, i): Scene => ({ kind: 'item', id: `item-${i + 1}`, startSec: 0, endSec: 0, subtitle: [], title: item.title, qty: item.qty, price: prices.items[i], image: item.imageUrl })),
    { kind: 'ending', id: 'ending', startSec: 0, endSec: 0, subtitle: [], more: view.items.length - shown.length },
  ];
  const itemSec = shown.length ? (job.durationSec - OPENING_SEC - ENDING_SEC) / shown.length : 0;
  const durations = scenes.map(scene => scene.kind === 'opening' ? (shown.length ? OPENING_SEC : job.durationSec - ENDING_SEC) : scene.kind === 'ending' ? ENDING_SEC : itemSec);
  return retime(scenes, durations, job.durationSec);
}

/** The owner hosts, so the lines are theirs: a sentence per line from the view alone. The cards already show prices and the total, so the words stay short; fitting lines to the screen is the QA loop's job. */
export function fallbackSubtitle(scene: Scene, mode: ShareView['mode'], language: PromoLanguage = 'zh-TW'): string[] {
  const words = PROMO_WORDS[language];
  switch (scene.kind) {
    case 'opening': return words.opening(scene.nickname, scene.count);
    case 'item': return words.item(scene.title, scene.qty, scene.price, mode === 'range');
    case 'ending': return words.ending(scene.more);
  }
}

export const withSubtitles = (view: ShareView, scenes: Scene[], subtitles: (scene: Scene) => string[], language: PromoLanguage = 'zh-TW'): Storyboard =>
  storyboardSchema.parse({ durationSec: scenes.at(-1)!.endSec, priceMode: view.mode, language, scenes: scenes.map(scene => ({ ...scene, subtitle: subtitles(scene) })) });

export const fallbackStoryboard = (view: ShareView, job: JobShape): Storyboard =>
  withSubtitles(view, sceneFrames(view, job), scene => fallbackSubtitle(scene, view.mode, job.language), job.language);

/** Anything that reads as an amount of money; a hidden-price storyboard must contain none. */
export const PRICE_PATTERN = /NT\$|\$\s*\d|\d[\d,]*\s*(元|塊)/;

import { z } from 'zod';
import type { ShareView } from './share.ts';

/** The showroom has no checkout, so the video must never sound like a shop asking you to pay. Each rule also names its softer wording. */
export const FORBIDDEN_WORDING: readonly (readonly [RegExp, string])[] = [
  [/立即購買|馬上購買|立即下單/g, '先記下來'],
  [/結帳|結賬|付款|下單/g, '記下'],
  [/購買/g, '收藏'],
  [/check\s?out|buy now|order now|add to cart/gi, 'noted'],
];
export const forbiddenWords = (text: string) => [...new Set(FORBIDDEN_WORDING.flatMap(([pattern]) => text.match(pattern) ?? []))];

/** Anything that reads as an amount of money; a hidden-price storyboard must contain none. */
export const PRICE_PATTERN = /NT\$|\$\s*\d|\d[\d,]*\s*(元|塊)/;

const OPENING_SEC = 4, ENDING_SEC = 5, MIN_ITEM_SEC = 2;
/** Up to 8 items get a scene of at least two seconds each; the ending counts the rest. */
export const itemSceneCount = (items: number, durationSec: number) => Math.min(items, 8, Math.floor((durationSec - OPENING_SEC - ENDING_SEC) / MIN_ITEM_SEC));
export const OPENING_SECONDS = OPENING_SEC, ENDING_SECONDS = ENDING_SEC;

/** Spoken lines are short: the subtitle is one line per page row at 24 full-width characters, and QA wraps what is longer. */
export const SCRIPT_LIMITS = { lineChars: 30, opening: 3, item: 2, ending: 3, items: 8 } as const;

const lines = (max: number) => z.array(z.string().trim().min(1, '不能是空行').superRefine((text, ctx) => {
  if ([...text].length > SCRIPT_LIMITS.lineChars) ctx.addIssue({ code: 'custom', message: `「${text.slice(0, 12)}…」有 ${[...text].length} 字，一行最多 ${SCRIPT_LIMITS.lineChars} 字；口白拆成短句，分成多行。` });
  const words = forbiddenWords(text);
  if (words.length) ctx.addIssue({ code: 'custom', message: `「${text.slice(0, 12)}…」出現「${words.join('、')}」，小屋沒有結帳流程；改說「記下」「收藏」「放進小屋」。` });
})).min(1, '至少一行').max(max, `這一景最多 ${max} 行，多的併進同一句或留給下一景`);

/**
 * Muse's script for the intro, in the owner's first-person voice. Every scene is optional; one Muse leaves out gets the
 * runner's usual lines. An item is named by `position`, its place on the shelf counted from 1 in cart_list order: titles
 * repeat and Muse tends to shorten them, a position cannot be misread. `title` is only an optional check that the position
 * is the item Muse meant.
 */
export const promoScriptSchema = z.strictObject({
  opening: lines(SCRIPT_LIMITS.opening).optional(),
  items: z.array(z.strictObject({
    position: z.number().int().min(1).max(SCRIPT_LIMITS.items),
    title: z.string().trim().min(1).max(200).optional(),
    lines: lines(SCRIPT_LIMITS.item),
  })).max(SCRIPT_LIMITS.items).optional(),
  ending: lines(SCRIPT_LIMITS.ending).optional(),
}).superRefine((script, ctx) => {
  if (!script.opening && !script.items?.length && !script.ending) ctx.addIssue({ code: 'custom', message: '腳本至少要有 opening、items 或 ending 其中一景。' });
  const seen = new Set<number>();
  script.items?.forEach((item, i) => {
    if (seen.has(item.position)) ctx.addIssue({ code: 'custom', path: ['items', i, 'position'], message: `position ${item.position} 寫了兩次，每件東西只有一景。` });
    seen.add(item.position);
  });
});
export type PromoScript = z.output<typeof promoScriptSchema>;

const normal = (text: string) => text.replace(/\s+/g, '').toLowerCase();

/**
 * What a valid script still cannot know without the cart: which items get a scene at this length, whether `title` names the
 * item at `position`, and whether the owner hides prices. Runs when Muse queues the video and again when the runner claims
 * it, since the owner can change the price choice in between. Each message says what to change.
 */
export function scriptProblems(script: PromoScript, view: Pick<ShareView, 'mode' | 'items'>, durationSec: number): string[] {
  const shown = itemSceneCount(view.items.length, durationSec), problems: string[] = [];
  for (const item of script.items ?? []) {
    const at = view.items[item.position - 1];
    if (item.position > shown) problems.push(`items 的 position ${item.position} 沒有場景：${durationSec} 秒、${view.items.length} 件東西，只有前 ${shown} 件各有一景。拿掉它，或把 durationSec 加長。`);
    else if (item.title && !normal(at.title).includes(normal(item.title)) && !normal(item.title).includes(normal(at.title)))
      problems.push(`items 的 position ${item.position} 寫的 title「${item.title}」，但貨架第 ${item.position} 件是「${at.title}」。position 照 cart_list 的順序從 1 算起；要嘛改 position，要嘛拿掉 title。`);
  }
  if (view.mode === 'hidden') {
    const priced = [['opening', script.opening], ...(script.items ?? []).map(item => [`items position ${item.position}`, item.lines] as const), ['ending', script.ending]] as const;
    for (const [where, text] of priced) if (text && PRICE_PATTERN.test(text.join(''))) problems.push(`${where} 提到價錢，但屋主把價格設成隱藏。拿掉金額；畫面上的卡片會替你處理價格。`);
  }
  return problems;
}

/** Scene id to lines, in the ids the storyboard uses: `opening`, `item-<position>`, `ending`. */
export const scriptScenes = (script: PromoScript): Map<string, string[]> => new Map([
  ...script.opening ? [['opening', script.opening] as const] : [],
  ...(script.items ?? []).map(item => [`item-${item.position}`, item.lines] as const),
  ...script.ending ? [['ending', script.ending] as const] : [],
]);

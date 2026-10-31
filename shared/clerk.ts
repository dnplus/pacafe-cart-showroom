import { z } from 'zod';
import { PROMO_LANGUAGES, type PromoLanguage } from './promo.ts';

/**
 * The clerk who lives in the showroom: Muse Spark on the Meta Model API, with the cart tools Muse Code gets over /mcp.
 * The owner talks to it from the room; a share page never reaches it. The house key pays up to a daily limit; past that the
 * owner can save their own key, kept with the showroom like the voice key and shown by its last four characters only.
 */
export const CLERK_MODEL = 'muse-spark-1.3';
export const CLERK_LIMITS = { messageChars: 500, toolCallsPerTurn: 8, modelStepsPerTurn: 6, keptTurns: 24, dailyUsd: 2 } as const;
/** https://dev.meta.ai/docs/pricing-rate-limits, the same figures the runner's Spark calls use. */
export const SPARK_PRICE = { inputPerM: 1.25, outputPerM: 4.25 } as const;
export const sparkCost = (input: number, output: number) => input / 1e6 * SPARK_PRICE.inputPerM + output / 1e6 * SPARK_PRICE.outputPerM;

const at = z.iso.datetime();
export const clerkCallSchema = z.strictObject({ name: z.string().max(80), ok: z.boolean() });
export const clerkTurnSchema = z.strictObject({ role: z.enum(['owner', 'clerk']), text: z.string().max(4000), at, calls: z.array(clerkCallSchema).max(CLERK_LIMITS.toolCallsPerTurn).default([]) });
export type ClerkTurn = z.infer<typeof clerkTurnSchema>;

const apiKey = z.string().trim().min(8).max(400);
export const clerkStateSchema = z.strictObject({
  turns: z.array(clerkTurnSchema).default([]),
  /** Spend on the house key, per UTC day; the owner's own key is theirs to spend. */
  usage: z.strictObject({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), costUsd: z.number().nonnegative(), turns: z.number().int().nonnegative() }).nullable().default(null),
  ownKey: z.strictObject({ apiKey, baseUrl: z.url().nullable() }).nullable().default(null),
});
export type ClerkState = z.infer<typeof clerkStateSchema>;
export const emptyClerkState = (): ClerkState => clerkStateSchema.parse({});

export const clerkSendSchema = z.strictObject({ message: z.string().trim().min(1).max(CLERK_LIMITS.messageChars), language: z.enum(PROMO_LANGUAGES).default('zh-TW') });
export const clerkKeySchema = z.strictObject({ apiKey, baseUrl: z.url().optional() });

export const today = (now: Date) => now.toISOString().slice(0, 10);
/** Today's house spend; yesterday's no longer counts. */
export const spentToday = (state: ClerkState, now: Date) => state.usage?.day === today(now) ? state.usage.costUsd : 0;

/** Which key the next turn uses: the owner's own, the house one while today's spend is under the limit, or none. */
export type KeyChoice = { kind: 'own' | 'house'; apiKey: string; baseUrl: string } | { kind: 'none'; reason: 'no_key' | 'daily_limit' };
export function chooseKey(state: ClerkState, house: { apiKey?: string; baseUrl?: string }, now: Date, limitUsd: number = CLERK_LIMITS.dailyUsd): KeyChoice {
  const baseUrl = state.ownKey?.baseUrl ?? house.baseUrl;
  if (state.ownKey && baseUrl) return { kind: 'own', apiKey: state.ownKey.apiKey, baseUrl };
  if (!house.apiKey || !house.baseUrl) return { kind: 'none', reason: 'no_key' };
  return spentToday(state, now) >= limitUsd ? { kind: 'none', reason: 'daily_limit' } : { kind: 'house', apiKey: house.apiKey, baseUrl: house.baseUrl };
}

/** What the room sees: the conversation, today's house spend, the own key's last four characters, and what the next turn would use. */
export function clerkView(state: ClerkState, house: { apiKey?: string; baseUrl?: string }, now: Date, limitUsd: number = CLERK_LIMITS.dailyUsd) {
  const choice = chooseKey(state, house, now, limitUsd);
  return {
    model: CLERK_MODEL,
    turns: state.turns,
    spentUsd: spentToday(state, now), limitUsd,
    ownKey: state.ownKey && { keyEnd: `…${state.ownKey.apiKey.slice(-4)}`, baseUrl: state.ownKey.baseUrl },
    ready: choice.kind === 'none' ? choice.reason : choice.kind,
    houseBaseUrl: Boolean(house.baseUrl),
  };
}
export type ClerkView = ReturnType<typeof clerkView>;

const RULES: Record<PromoLanguage, string> = {
  'zh-TW': '用台灣繁體中文回覆，口吻溫暖、簡短，一次回覆不超過四句。',
  en: 'Reply in natural English, warm and brief: four sentences at most.',
};

/** The clerk's standing instructions; the tools carry their own descriptions. */
export const clerkInstructions = (language: PromoLanguage, nickname: string) => [
  `You are Muse, the clerk of ${nickname}'s cart showroom: a small room that shows what Muse noted while shopping for the owner. It has no checkout and is no shop; never offer to buy, order or pay.`,
  `You are talking with the owner inside the room. Use the tools to look before you answer: cart_list for what is on the shelf and what the owner removed (with reasons), habits_report (with language "${language}") for spending habits.`,
  'When the owner removed something, acknowledge it, learn the taste from the reason, and never add it back unless asked.',
  'cart_add needs a product page URL you were given; never invent links, prices or stores. Give every item a category.',
  `For an intro video, call promo_generate with language "${language}" and write a script in the owner's first-person voice (they host the video; you are the clerk): short lines, no prices when the share mode hides them. Then tell the owner it is queued; the video appears in the Promo panel.`,
  RULES[language],
].join('\n');

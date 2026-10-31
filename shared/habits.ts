import { CART_CATEGORIES, type CartCategory, type CartItem } from './cart';
import type { Locale } from './locales';
import type { UnboxState } from './unbox';

/**
 * The shopping-habits report: what the cart's items say about how the owner's Muse shops. It is derived from the items in the
 * cart right now plus the unbox records, so anything removed from the cart is gone from it. One row is one cart line, and a
 * line's amount is its unit price times its quantity.
 */
export const UNCATEGORIZED = 'uncategorized';
export type CategoryKey = CartCategory | typeof UNCATEGORIZED;

/** Times are read in Taiwan time (UTC+8, no daylight saving), whatever the server's clock says. */
const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
export const TIME_OF_DAY = [{ id: 'lateNight', from: 0 }, { id: 'morning', from: 6 }, { id: 'afternoon', from: 12 }, { id: 'evening', from: 18 }] as const;
export const PRICE_BANDS = [{ id: 'under300', max: 300 }, { id: 'to1000', max: 1000 }, { id: 'to3000', max: 3000 }, { id: 'over3000', max: Infinity }] as const;

/** Every word the report says, per language; the numbers are the same in both. */
const WORDS = {
  'zh-TW': {
    categories: { fashion: '服飾配件', beauty: '美妝保養', electronics: '3C 家電', home: '居家生活', kitchen: '廚房餐具', food: '食品飲料', books: '書籍文具', hobby: '玩具嗜好', outdoor: '運動戶外', other: '其他', uncategorized: '未分類' },
    weekdays: ['週一', '週二', '週三', '週四', '週五', '週六', '週日'],
    times: { lateNight: ['凌晨', '0–5 時'], morning: ['上午', '6–11 時'], afternoon: ['下午', '12–17 時'], evening: ['晚上', '18–23 時'] },
    bands: { under300: '300 以下', to1000: '300–999', to3000: '1,000–2,999', over3000: '3,000 以上' },
    note: '只算目前購物車裡的東西，已經移除的不在內。時間是東西第一次被記進小屋的時間（台灣時間），不是下單時間。',
    topSpend: (label: string, money: string, percent: string) => `${label}花得最多，${money}，占總額的 ${percent}。`,
    topLines: (label: string, lines: number) => `${label}記得最多，共 ${lines} 筆，但都還沒有標價。`,
    night: (lines: number, night: number) => `${lines} 筆裡有 ${night} 筆是凌晨（0 到 5 點）記下的。`,
    weekend: (lines: number, weekend: number) => `${lines} 筆裡有 ${weekend} 筆是週末記下的。`,
    oldest: (unopened: number, title: string, days: number) => `還有 ${unopened} 件沒拆，最久的「${title}」已經放了 ${days} 天。`,
    unopened: (lines: number, unopened: number) => `${lines} 件裡還有 ${unopened} 件沒拆。`,
    unpriced: (lines: number) => `有 ${lines} 筆沒標價，總額和平均都沒有算它們。`,
  },
  en: {
    categories: { fashion: 'Fashion', beauty: 'Beauty', electronics: 'Electronics', home: 'Home', kitchen: 'Kitchen', food: 'Food and drink', books: 'Books and stationery', hobby: 'Toys and hobbies', outdoor: 'Sports and outdoor', other: 'Other', uncategorized: 'Uncategorized' },
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    times: { lateNight: ['Late night', '0–5'], morning: ['Morning', '6–11'], afternoon: ['Afternoon', '12–17'], evening: ['Evening', '18–23'] },
    bands: { under300: 'Under 300', to1000: '300–999', to3000: '1,000–2,999', over3000: '3,000 and up' },
    note: 'Counts only what is in the cart now; removed items are not included. Times are when an item was first noted in the showroom (Taiwan time), not when it was ordered.',
    topSpend: (label: string, money: string, percent: string) => `${label} takes the most: ${money}, ${percent} of the total.`,
    topLines: (label: string, lines: number) => `${label} has the most lines (${lines}), none of them priced yet.`,
    night: (lines: number, night: number) => `${night} of ${lines} lines were noted late at night (0 to 5 am).`,
    weekend: (lines: number, weekend: number) => `${weekend} of ${lines} lines were noted on a weekend.`,
    oldest: (unopened: number, title: string, days: number) => `${unopened} still unopened; the oldest, "${title}", has waited ${days} days.`,
    unopened: (lines: number, unopened: number) => `${unopened} of ${lines} parcels are still unopened.`,
    unpriced: (lines: number) => `${lines} lines have no price, so the total and the average leave them out.`,
  },
} as const satisfies Record<Locale, unknown>;
export const categoryLabel = (key: CategoryKey, locale: Locale = 'zh-TW') => WORDS[locale].categories[key];
const TOP_STORES = 5;
/** Below this many cart lines the report still shows its numbers but draws no conclusion about timing. */
const MIN_LINES_FOR_TIMING = 4;

export interface HabitsReport {
  scope: 'cart_now';
  note: string;
  totals: { lines: number; units: number; spendTwd: number; pricedLines: number; unpricedLines: number; averageTwd: number | null };
  biggest: { id: string; title: string; store: string | null; amountTwd: number } | null;
  categories: { key: CategoryKey; label: string; lines: number; spendTwd: number; share: number }[];
  stores: { store: string; lines: number; spendTwd: number }[];
  withoutStore: number;
  priceBands: { id: string; label: string; lines: number; spendTwd: number }[];
  weekdays: { label: string; lines: number }[];
  timeOfDay: { id: string; label: string; hours: string; lines: number }[];
  parcels: { opened: number; unopened: number; unopenedSpendTwd: number; oldestUnopened: { id: string; title: string; days: number } | null };
  observations: string[];
}

const amountOf = (item: CartItem) => (item.priceTwd ?? 0) * item.qty;
const taipei = (iso: string) => new Date(Date.parse(iso) + TAIPEI_OFFSET_MS);
const percent = (share: number) => `${Math.round(share * 100)}%`;
const money = (amount: number) => `NT$ ${Math.round(amount).toLocaleString('en-US')}`;

/** Sorts by spend, then line count, then the order the keys were first met, so ties always come out the same way. */
function rank<T extends { lines: number; spendTwd: number }>(rows: T[]) {
  return rows.map((row, order) => ({ row, order })).sort((a, b) => b.row.spendTwd - a.row.spendTwd || b.row.lines - a.row.lines || a.order - b.order).map(({ row }) => row);
}

export function habitsReport(items: readonly CartItem[], unbox: UnboxState, now: string, locale: Locale = 'zh-TW'): HabitsReport {
  const words = WORDS[locale];
  const spendTwd = items.reduce((sum, item) => sum + amountOf(item), 0);
  const priced = items.filter(item => item.priceTwd !== null);
  const totals = {
    lines: items.length, units: items.reduce((sum, item) => sum + item.qty, 0), spendTwd,
    pricedLines: priced.length, unpricedLines: items.length - priced.length, averageTwd: priced.length ? Math.round(spendTwd / priced.length) : null,
  };
  const top = priced.reduce<CartItem | null>((best, item) => !best || amountOf(item) > amountOf(best) ? item : best, null);

  const byCategory = new Map<CategoryKey, { lines: number; spendTwd: number }>();
  for (const item of items) {
    const key = item.category ?? UNCATEGORIZED, row = byCategory.get(key) ?? { lines: 0, spendTwd: 0 };
    byCategory.set(key, { lines: row.lines + 1, spendTwd: row.spendTwd + amountOf(item) });
  }
  const categoryOrder = [...CART_CATEGORIES, UNCATEGORIZED] as const;
  const categories = rank(categoryOrder.filter(key => byCategory.has(key)).map(key => ({
    key, label: words.categories[key], ...byCategory.get(key)!, share: spendTwd ? byCategory.get(key)!.spendTwd / spendTwd : 0,
  })));

  const byStore = new Map<string, { lines: number; spendTwd: number }>();
  for (const item of items) if (item.store) { const row = byStore.get(item.store) ?? { lines: 0, spendTwd: 0 }; byStore.set(item.store, { lines: row.lines + 1, spendTwd: row.spendTwd + amountOf(item) }); }
  const stores = rank([...byStore].map(([store, row]) => ({ store, ...row }))).slice(0, TOP_STORES);

  const priceBands = PRICE_BANDS.map((band, index) => {
    const min = index ? PRICE_BANDS[index - 1].max : 0, inBand = priced.filter(item => amountOf(item) >= min && amountOf(item) < band.max);
    return { id: band.id, label: words.bands[band.id], lines: inBand.length, spendTwd: inBand.reduce((sum, item) => sum + amountOf(item), 0) };
  });

  const weekdays = words.weekdays.map(label => ({ label, lines: 0 }));
  const timeOfDay = TIME_OF_DAY.map(({ id }) => ({ id, label: words.times[id][0], hours: words.times[id][1], lines: 0 }));
  for (const item of items) {
    const when = taipei(item.addedAt);
    weekdays[(when.getUTCDay() + 6) % 7].lines++;
    timeOfDay[Math.floor(when.getUTCHours() / 6)].lines++;
  }

  const unopened = items.filter(item => !(item.id in unbox.opened));
  const oldest = unopened.reduce<CartItem | null>((best, item) => !best || Date.parse(item.addedAt) < Date.parse(best.addedAt) ? item : best, null);
  const parcels = {
    opened: items.length - unopened.length, unopened: unopened.length, unopenedSpendTwd: unopened.reduce((sum, item) => sum + amountOf(item), 0),
    oldestUnopened: oldest ? { id: oldest.id, title: oldest.title, days: Math.max(0, Math.floor((Date.parse(now) - Date.parse(oldest.addedAt)) / DAY_MS)) } : null,
  };

  return {
    scope: 'cart_now',
    note: words.note,
    totals, biggest: top && { id: top.id, title: top.title, store: top.store, amountTwd: amountOf(top) },
    categories, stores, withoutStore: items.filter(item => !item.store).length, priceBands, weekdays, timeOfDay, parcels,
    observations: observe({ totals, categories, timeOfDay, weekdays, parcels }, words),
  };
}

/** Up to three plain sentences, each only when the numbers back it; a cart with nothing to say gets none. */
function observe({ totals, categories, timeOfDay, weekdays, parcels }: Pick<HabitsReport, 'totals' | 'categories' | 'timeOfDay' | 'weekdays' | 'parcels'>, words: typeof WORDS[Locale]): string[] {
  const out: string[] = [];
  const [first, second] = categories;
  if (first && totals.spendTwd > 0 && first.share >= 0.4 && first.spendTwd > (second?.spendTwd ?? 0)) {
    out.push(words.topSpend(first.label, money(first.spendTwd), percent(first.share)));
  } else if (first && totals.spendTwd === 0 && first.lines > (second?.lines ?? 0) && first.lines >= 2) {
    out.push(words.topLines(first.label, first.lines));
  }
  if (totals.lines >= MIN_LINES_FOR_TIMING) {
    const night = timeOfDay[0];
    const weekend = weekdays[5].lines + weekdays[6].lines;
    if (night.lines >= 2 && night.lines / totals.lines >= 0.4) out.push(words.night(totals.lines, night.lines));
    else if (weekend / totals.lines >= 0.6) out.push(words.weekend(totals.lines, weekend));
  }
  const { oldestUnopened } = parcels;
  if (oldestUnopened && oldestUnopened.days >= 3) out.push(words.oldest(parcels.unopened, oldestUnopened.title, oldestUnopened.days));
  else if (parcels.unopened > 0 && parcels.unopened / totals.lines >= 0.5) out.push(words.unopened(totals.lines, parcels.unopened));
  if (totals.unpricedLines > 0 && out.length < 3) out.push(words.unpriced(totals.unpricedLines));
  return out.slice(0, 3);
}

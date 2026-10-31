import { z } from 'zod';
import { addCartItem, cartItemInputSchema, cartQty, MAX_CART_ITEMS, removeCartItem, type Cart } from '../shared/cart';
import { habitsReport } from '../shared/habits';
import { recentRemovals, removedBefore, removedNote, type Removal } from '../shared/removals';
import type { UnboxState } from '../shared/unbox';
import { PROMO_LANGUAGES, promoJobId, promoRequestSchema, type PromoRecord } from '../shared/promo';
import { shareUrl, type ShareSettings } from '../shared/share';
import { withProductImages } from './productPage';
import { queuePromo, ScriptRefused } from './promo';

export interface Store {
  cart(): Promise<Cart>;
  saveCart(cart: Cart): Promise<void>;
  /** What the owner took out of the cart in the room, oldest first. */
  removals(): Promise<Removal[]>;
  /** Which parcels the owner has opened. */
  unbox(): Promise<UnboxState>;
  /** Made on first ask, so a showroom nobody shares never gets a slug. */
  share(): Promise<ShareSettings>;
  saveShare(settings: ShareSettings): Promise<void>;
  promo(id: string): Promise<PromoRecord | undefined>;
  latestPromo(): Promise<PromoRecord | undefined>;
  /** Stores a new job, makes it the latest and puts it last in the queue. */
  queuePromo(record: PromoRecord): Promise<void>;
  /** Jobs that are not done or failed, oldest first. */
  promoQueue(): Promise<PromoRecord[]>;
  /** Stores a changed job; once it is done or failed it leaves the queue. */
  savePromo(record: PromoRecord): Promise<void>;
}

/** A refusal the model can act on; the message goes back to it as a failed tool result. */
export class ToolError extends Error {}

export interface Tool {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false };
  run(store: Store, args: unknown, origin: string): Promise<object>;
}
const tool = <S extends z.ZodType>(spec: Omit<Tool, 'input' | 'run'> & { input: S; run(store: Store, args: z.output<S>, origin: string): Promise<object> }): Tool => spec;

const now = () => new Date().toISOString();
const saved = async (store: Store, before: Cart, after: Cart) => { if (after !== before) await store.saveCart(after); return after; };

export const tools: readonly Tool[] = [
  tool({
    name: 'cart_add', title: '加入購物車', description: '把買到或看上的東西記進小屋購物車。url 請填商品頁的原始連結，小屋會在房間附上連結；沒給 imageUrl 時，小屋會從商品頁抓圖。category 是商品分類，給購物習慣報表用。同名、同店、同連結的東西會合併數量。如果屋主之前從房間移除過同連結或同名的東西，回傳會多一個 note 說明，請先問屋主再決定留不留。只做記錄，不會下單。',
    input: cartItemInputSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(store, args) {
      const cart = await store.cart(), [input] = await withProductImages([args], cart), next = addCartItem(cart, input, now());
      if (next.items.length > MAX_CART_ITEMS) throw new ToolError(`購物車已滿（最多 ${MAX_CART_ITEMS} 項），先用 cart_remove 移除不要的東西。`);
      const removed = removedBefore(await store.removals(), input);
      await saved(store, cart, next);
      return removed ? { ...next, note: removedNote(removed) } : next;
    },
  }),
  tool({
    name: 'cart_list', title: '查看購物車', description: '列出購物車內容、總額，以及分享連結、是否已開啟分享和訪客看到的價格（hidden 隱藏、range 區間、exact 精確）。removals 是屋主最近從房間移除的東西（新的在前、最多 20 筆，含品名、連結、店、分類、價格、原因和時間）；原因是 not_my_taste 不合口味、too_expensive 太貴、already_have 已經有了、changed_mind 改變主意，或 null 沒說。這些是屋主的口味，別再記回來。',
    input: z.strictObject({}), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(store, _args, origin) {
      const [cart, share, removals] = await Promise.all([store.cart(), store.share(), store.removals()]);
      return { ...cart, share: { url: shareUrl(origin, share.slug), enabled: share.enabled, prices: share.prices }, removals: recentRemovals(removals) };
    },
  }),
  tool({
    name: 'habits_report', title: '購物習慣報表', description: '讀取購物習慣報表：各分類和各店的花費與件數、價位分布、記下東西的星期和時段（台灣時間）、平均與最貴的一筆、沒標價的件數、已拆和還沒拆的快遞，以及幾句從數字推出來的觀察。只算目前購物車裡的東西，已移除的不在內。language 決定分類名稱和觀察句的語言（預設 zh-TW）。唯讀。',
    input: z.strictObject({ language: z.enum(PROMO_LANGUAGES).default('zh-TW') }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(store, args) {
      const [cart, unbox] = await Promise.all([store.cart(), store.unbox()]);
      return habitsReport(cart.items, unbox, now(), args.language);
    },
  }),
  tool({
    name: 'cart_remove', title: '移出購物車', description: '從購物車拿掉一項東西。不給 qty 就整項移除；給 qty 就只減少那個數量。itemId 來自 cart_list。',
    input: z.strictObject({ itemId: z.string().min(1).max(80), qty: cartQty.optional() }), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async run(store, args) {
      const cart = await store.cart();
      if (!cart.items.some(item => item.id === args.itemId)) throw new ToolError(`購物車裡沒有 itemId「${args.itemId}」，請先用 cart_list 查看。`);
      return saved(store, cart, removeCartItem(cart, args.itemId, args.qty, now()));
    },
  }),
  tool({
    name: 'promo_generate', title: '排程介紹影片', description: '為目前的購物車排一支介紹影片，回傳 jobId，再用 promo_status 查進度。購物車沒變、參數相同時重複呼叫會回傳同一個 jobId。可以用 script 自己寫口白：影片由屋主本人主持，口白是屋主的第一人稱；opening 是開場，items 每項用 position（貨架順序，從 1 算起，和 cart_list 一樣）對應一件東西，ending 是結尾。每景 1 到 3 行、一行最多 30 字，不要出現結帳、下單、購買這類字眼，屋主隱藏價格時不要提金額。沒寫的景由 runner 補上預設口白。',
    input: promoRequestSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(store, args) {
      let job;
      try { job = await queuePromo(store, args); } catch (error) {
        if (error instanceof ScriptRefused) throw new ToolError(`腳本沒有收下，請修改後再呼叫 promo_generate：${error.problems.join('；')}`);
        throw error;
      }
      if (!job) throw new ToolError('購物車是空的，先用 cart_add 記下東西再排介紹片。');
      return { jobId: job.id, status: job.status };
    },
  }),
  tool({
    name: 'promo_status', title: '查詢影片進度', description: '用 promo_generate 回傳的 jobId 查介紹影片的狀態、進度和成品連結。',
    input: z.strictObject({ jobId: promoJobId }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(store, args) {
      const record = await store.promo(args.jobId);
      if (!record) throw new ToolError(`找不到 jobId「${args.jobId}」，請用 promo_generate 回傳的 jobId。`);
      return record.job;
    },
  }),
];

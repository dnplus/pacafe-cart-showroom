import { z } from 'zod';
import { webUrl, type Cart } from './cart';

export const PROMO_STATUSES = ['queued', 'storyboard', 'voice', 'rendering', 'done', 'failed'] as const;

const timestamp = z.iso.datetime();

/** What Muse asks for; the video itself is made by the S4 runner. */
export const promoRequestSchema = z.strictObject({
  durationSec: z.number().int().min(15).max(45).default(30),
  style: z.string().trim().min(1).max(200).optional(),
});
export type PromoRequest = z.output<typeof promoRequestSchema>;

export const promoJobSchema = z.strictObject({
  id: z.string().min(1).max(100),
  /** The cart revision the video is made from. */
  cartRevision: z.number().int().nonnegative(),
  durationSec: z.number().int().min(15).max(45),
  style: z.string().nullable(),
  status: z.enum(PROMO_STATUSES),
  progress: z.number().min(0).max(1),
  output: z.strictObject({ videoUrl: webUrl, thumbnailUrl: webUrl, sha256: z.string().regex(/^[0-9a-f]{64}$/), durationSec: z.number().positive() }).nullable(),
  error: z.string().nullable(),
  costUsd: z.number().nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type PromoJob = z.infer<typeof promoJobSchema>;

/** A job with the cart as it was when queued, which is what the runner renders. */
export interface PromoRecord { job: PromoJob; cart: Cart }

export const queuedPromoJob = (id: string, cart: Cart, request: PromoRequest, now: string): PromoJob => ({
  id, cartRevision: cart.revision, durationSec: request.durationSec, style: request.style ?? null, status: 'queued', progress: 0, output: null, error: null, costUsd: 0, createdAt: now, updatedAt: now,
});

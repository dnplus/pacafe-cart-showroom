import { z } from 'zod';
import { promoJobSchema, PROMO_STATUSES } from './promo.ts';
import { shareViewSchema } from './share.ts';
import { voiceConfigSchema } from './voice.ts';

/**
 * The contract between the worker and the S4 promo runner (runner/). Every route needs `Authorization: Bearer <CART_MCP_TOKEN>`,
 * env.local included, as /mcp does.
 *
 * - `POST /runner/next`: 200 `RunnerClaim` and the job moves to `storyboard`, or 204 when nothing waits.
 * - `PUT /runner/jobs/<id>/media/<name>`: the raw file, `name` one of RUNNER_MEDIA; 200 `{ key, url }`. Only while the job runs.
 * - `POST /runner/jobs/<id>`: a `RunnerUpdate`; 200 the `PromoJob`, 409 for a step PROMO_STEPS does not allow, 404 for an unknown job.
 *
 * Both job routes need the claim's `claimId` in RUNNER_CLAIM_HEADER, and answer 409 `stale_claim` once the job has been
 * claimed again: a runner that went quiet past its lease can no longer move, fail or finish the run that replaced it.
 */
export type PromoStatus = typeof PROMO_STATUSES[number];

/** Where a job may go from each status. A report of the status it is already in only moves its progress. */
export const PROMO_STEPS: Readonly<Record<PromoStatus, readonly PromoStatus[]>> = {
  queued: ['storyboard', 'failed'],
  storyboard: ['storyboard', 'voice', 'failed'],
  voice: ['voice', 'rendering', 'failed'],
  rendering: ['rendering', 'done', 'failed'],
  done: [],
  failed: [],
};

/** A claim lasts this long; every update renews it, and `/runner/next` offers a job again once its runner has gone quiet past it. */
export const RUNNER_LEASE_MS = 20 * 60 * 1000;

export const RUNNER_CLAIM_HEADER = 'x-runner-claim';

/** `claimId` is new on every claim and goes back in RUNNER_CLAIM_HEADER. `voice` carries its key; null leaves the runner to its own TTS_PROVIDER. */
export const runnerClaimSchema = z.strictObject({ job: promoJobSchema, view: shareViewSchema, leaseUntil: z.iso.datetime(), claimId: z.uuid(), voice: voiceConfigSchema.nullable().default(null) });
export type RunnerClaim = z.infer<typeof runnerClaimSchema>;

const costUsd = z.number().nonnegative();
/** Done carries no URLs: the worker builds them from the files already uploaded, so a done job without its video cannot exist. */
export const runnerUpdateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.enum(['storyboard', 'voice', 'rendering']), progress: z.number().min(0).max(1), costUsd }),
  z.strictObject({ status: z.literal('done'), costUsd, video: z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/), durationSec: z.number().positive() }) }),
  z.strictObject({ status: z.literal('failed'), costUsd, error: z.string().trim().min(1).max(500) }),
]);
export type RunnerUpdate = z.infer<typeof runnerUpdateSchema>;

/**
 * The files a runner uploads for a job, stored per claim as `promo/<jobId>/<claimId>/<name>`, so bytes from a runner that lost
 * the job never land where the current run's done looks. Done needs the video and the thumbnail.
 */
export const RUNNER_MEDIA = { 'video.mp4': 'video/mp4', 'thumbnail.jpg': 'image/jpeg', 'qa.json': 'application/json' } as const;
export type RunnerMedia = keyof typeof RUNNER_MEDIA;
export const promoMediaKey = (jobId: string, claimId: string, name: RunnerMedia) => `promo/${jobId}/${claimId}/${name}`;

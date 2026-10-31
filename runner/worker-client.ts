import { promoJobSchema, type PromoJob } from '../shared/promo.ts';
import { RUNNER_CLAIM_HEADER, RUNNER_MEDIA, runnerClaimSchema, runnerUpdateSchema, type RunnerClaim, type RunnerMedia, type RunnerUpdate } from '../shared/runner.ts';

/** The worker's side of shared/runner.ts, as the runner sees it. Reports and uploads go out under the claim they belong to. */
export interface RunnerWorker {
  next(): Promise<RunnerClaim | null>;
  update(claim: RunnerClaim, update: RunnerUpdate): Promise<PromoJob>;
  upload(claim: RunnerClaim, name: RunnerMedia, body: Uint8Array<ArrayBuffer>): Promise<void>;
}

export function workerClient(origin: string, token: string, http: typeof fetch = fetch): RunnerWorker {
  const call = async (method: string, path: string, claim?: RunnerClaim, body?: BodyInit, type = 'application/json') => {
    const headers = { authorization: `Bearer ${token}`, ...claim ? { [RUNNER_CLAIM_HEADER]: claim.claimId } : {}, ...body === undefined ? {} : { 'content-type': type } };
    const response = await http(`${origin}${path}`, { method, body, headers });
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return response;
  };
  return {
    async next() {
      const response = await call('POST', '/runner/next');
      return response.status === 204 ? null : runnerClaimSchema.parse(await response.json());
    },
    async update(claim, update) {
      const response = await call('POST', `/runner/jobs/${claim.job.id}`, claim, JSON.stringify(runnerUpdateSchema.parse(update)));
      return promoJobSchema.parse(await response.json());
    },
    async upload(claim, name, body) {
      await call('PUT', `/runner/jobs/${claim.job.id}/media/${name}`, claim, body, RUNNER_MEDIA[name]);
    },
  };
}

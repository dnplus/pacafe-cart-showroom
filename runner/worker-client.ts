import { promoJobSchema, type PromoJob } from '../shared/promo.ts';
import { RUNNER_MEDIA, runnerClaimSchema, runnerUpdateSchema, type RunnerClaim, type RunnerMedia, type RunnerUpdate } from '../shared/runner.ts';

/** The worker's side of shared/runner.ts, as the runner sees it. */
export interface RunnerWorker {
  next(): Promise<RunnerClaim | null>;
  update(jobId: string, update: RunnerUpdate): Promise<PromoJob>;
  upload(jobId: string, name: RunnerMedia, body: Uint8Array<ArrayBuffer>): Promise<void>;
}

export function workerClient(origin: string, token: string, http: typeof fetch = fetch): RunnerWorker {
  const call = async (method: string, path: string, body?: BodyInit, type = 'application/json') => {
    const response = await http(`${origin}${path}`, { method, body, headers: { authorization: `Bearer ${token}`, ...body === undefined ? {} : { 'content-type': type } } });
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return response;
  };
  return {
    async next() {
      const response = await call('POST', '/runner/next');
      return response.status === 204 ? null : runnerClaimSchema.parse(await response.json());
    },
    async update(jobId, update) {
      const response = await call('POST', `/runner/jobs/${jobId}`, JSON.stringify(runnerUpdateSchema.parse(update)));
      return promoJobSchema.parse(await response.json());
    },
    async upload(jobId, name, body) {
      await call('PUT', `/runner/jobs/${jobId}/media/${name}`, body, RUNNER_MEDIA[name]);
    },
  };
}

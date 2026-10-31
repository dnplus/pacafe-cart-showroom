import { useCallback, useEffect, useState } from 'react';
import { promoJobSchema, type PromoJob } from '../../shared/promo';
import { ownerFetch } from '../owner';
import { getLocale } from '../i18n';

export const PROMO_POLL_MS = 3000;

export interface PromoState {
  /** The latest job, or null when none was ever queued; undefined until the first answer. */
  job: PromoJob | null | undefined;
  /** The last status check failed and is being retried. */
  offline: boolean;
  queueing: boolean;
  queueFailed: boolean;
}

/**
 * The latest video job from /api/promo, read every PROMO_POLL_MS. Polling goes on past done or failed, because a resident can
 * queue the next job through MCP while the room is open. `queue` asks the worker for a new job and reads it at once.
 */
export function usePromo(intervalMs = PROMO_POLL_MS): PromoState & { queue: () => Promise<void> } {
  const [state, setState] = useState<PromoState>({ job: undefined, offline: false, queueing: false, queueFailed: false });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await ownerFetch('/api/promo', { signal: controller.signal });
        if (!response.ok) throw new Error(`GET /api/promo answered ${response.status}`);
        const job = promoJobSchema.nullable().parse(await response.json());
        setState(previous => ({ ...previous, job, offline: false }));
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn(error);
        setState(previous => ({ ...previous, offline: true }));
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, intervalMs);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [intervalMs, round]);

  const queue = useCallback(async () => {
    setState(previous => ({ ...previous, queueing: true, queueFailed: false }));
    try {
      const response = await ownerFetch('/api/promo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: getLocale() }) });
      if (!response.ok) throw new Error(`POST /api/promo answered ${response.status}`);
      setRound(count => count + 1);
      setState(previous => ({ ...previous, queueing: false }));
    } catch (error) {
      console.warn(error);
      setState(previous => ({ ...previous, queueing: false, queueFailed: true }));
    }
  }, []);
  return { ...state, queue };
}

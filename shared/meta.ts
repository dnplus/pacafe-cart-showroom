/** The Meta Model API as the clerk and the runner both call it: one model, one price list, one chat-completions request. */
export const SPARK_MODEL = 'muse-spark-1.3';
/** https://dev.meta.ai/docs/pricing-rate-limits */
export const SPARK_PRICE = { inputPerM: 1.25, outputPerM: 4.25 } as const;
export const sparkCost = (input: number, output: number) => input / 1e6 * SPARK_PRICE.inputPerM + output / 1e6 * SPARK_PRICE.outputPerM;

export const metaBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '');
/** An error's text with the key taken out, short enough to show the owner. */
export const redactKey = (error: unknown, apiKey: string) => (error instanceof Error ? error.message : String(error)).replaceAll(apiKey, '[REDACTED]').slice(0, 300);

/** One chat completion; the parsed JSON of the answer, or an Error for any status but 2xx. */
export async function chatCompletion(http: typeof fetch, config: { baseUrl: string; apiKey: string }, body: Record<string, unknown>): Promise<unknown> {
  const response = await http(`${metaBase(config.baseUrl)}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: SPARK_MODEL, ...body }),
  });
  if (!response.ok) throw new Error(`Meta Model API answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

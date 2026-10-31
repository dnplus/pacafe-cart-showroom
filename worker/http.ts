import type { z } from 'zod';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
export const invalidBody = (error: z.ZodError) => json({ error: 'invalid_body', issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }, 400);
export const notAllowed = (...methods: string[]) => json({ error: 'method_not_allowed' }, 405, { allow: methods.join(', ') });
export const readJson = (request: Request) => request.json().then((body: unknown) => ({ body }), () => null);
export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<{ data: z.output<T> } | Response> {
  const sent = await readJson(request);
  if (!sent) return json({ error: 'invalid_json' }, 400);
  const parsed = schema.safeParse(sent.body);
  return parsed.success ? { data: parsed.data } : invalidBody(parsed.error);
}
export const readOr = async <T extends z.ZodType, F>(storage: { get(key: string): Promise<unknown> }, key: string, schema: T, fallback: F): Promise<z.output<T> | F> => {
  const stored = await storage.get(key);
  return stored === undefined ? fallback : schema.parse(stored);
};

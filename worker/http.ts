import type { z } from 'zod';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
export const invalidBody = (error: z.ZodError) => json({ error: 'invalid_body', issues: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }, 400);
/** The parsed body, or null when it is not JSON. */
export const readJson = (request: Request) => request.json().then((body: unknown) => ({ body }), () => null);

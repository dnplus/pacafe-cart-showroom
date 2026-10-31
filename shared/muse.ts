import { z } from 'zod';

export const museActivitySchema = z.strictObject({
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  client: z.strictObject({ name: z.string().max(120), version: z.string().max(60) }).nullable(),
  lastTool: z.strictObject({ name: z.string().max(80), at: z.iso.datetime() }).nullable(),
});
export type MuseActivity = z.infer<typeof museActivitySchema>;

export interface McpCall { method: string; client?: { name: string; version: string }; tool?: string }

export function noteCall(previous: MuseActivity | null, call: McpCall, at: string): MuseActivity {
  return {
    firstSeenAt: previous?.firstSeenAt ?? at,
    lastSeenAt: at,
    client: call.client ? { name: call.client.name.slice(0, 120), version: call.client.version.slice(0, 60) } : previous?.client ?? null,
    lastTool: call.tool ? { name: call.tool.slice(0, 80), at } : previous?.lastTool ?? null,
  };
}

export const museStatusSchema = z.strictObject({ tokenSet: z.boolean(), activity: museActivitySchema.nullable() });
export type MuseStatus = z.infer<typeof museStatusSchema>;

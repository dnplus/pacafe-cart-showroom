import { museActivitySchema, noteCall, type McpCall, type MuseActivity } from '../shared/muse';
import { emptyVoiceSettings, speak, updateVoice, voiceConfig, voiceSettingsSchema, voiceUpdateSchema, voiceView, type VoiceSettings } from '../shared/voice';
import { isOwner, unauthorized } from './auth';
import type { Env } from './env';
import { invalidBody, json, readJson } from './http';

const MUSE_KEY = 'muse';
const VOICE_KEY = 'voice';
const SAMPLE = '歡迎來到我的小屋購物車！';

export const connectionsPath = /^\/api\/(muse|voice|voice\/test)$/;

export function connections(storage: DurableObjectStorage, env: Env, http: typeof fetch = fetch) {
  const activity = async () => { const stored = await storage.get(MUSE_KEY); return stored === undefined ? null : museActivitySchema.parse(stored); };
  const voice = async (): Promise<VoiceSettings> => { const stored = await storage.get(VOICE_KEY); return stored === undefined ? emptyVoiceSettings() : voiceSettingsSchema.parse(stored); };

  async function handle(request: Request, which: string) {
    if (!isOwner(request, env)) return unauthorized();
    if (which === 'muse') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
      return json({ tokenSet: Boolean(env.CART_MCP_TOKEN), activity: await activity() });
    }
    if (which === 'voice/test') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      const settings = await voice(), config = voiceConfig(settings);
      if (!config) return json({ error: 'no_voice' }, 409);
      const at = new Date().toISOString();
      try {
        const audio = await speak(config, SAMPLE, http);
        await storage.put(VOICE_KEY, { ...settings, check: { at, ok: true, message: `${audio.byteLength} bytes` } });
        return new Response(audio, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).replaceAll(config.apiKey, '[REDACTED]').slice(0, 300);
        await storage.put(VOICE_KEY, { ...settings, check: { at, ok: false, message } });
        return json({ error: 'voice_failed', message }, 502);
      }
    }
    if (request.method === 'GET') return json(voiceView(await voice()));
    if (request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, PUT' });
    const sent = await readJson(request);
    if (!sent) return json({ error: 'invalid_json' }, 400);
    const parsed = voiceUpdateSchema.safeParse(sent.body);
    if (!parsed.success) return invalidBody(parsed.error);
    const next = updateVoice(await voice(), parsed.data);
    if ('missing' in next) return json({ error: 'missing_key', provider: next.missing }, 400);
    await storage.put(VOICE_KEY, next);
    return json(voiceView(next));
  }

  return {
    handle,
    runnerVoice: async () => voiceConfig(await voice()),
    note: async (call: McpCall) => { const next: MuseActivity = noteCall(await activity(), call, new Date().toISOString()); await storage.put(MUSE_KEY, next); },
  };
}

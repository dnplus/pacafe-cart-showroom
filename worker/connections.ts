import { museActivitySchema, noteCall, type McpCall, type MuseActivity } from '../shared/muse';
import { emptyVoiceSettings, speak, updateVoice, voiceConfig, voiceSettingsSchema, voiceUpdateSchema, voiceView, type VoiceSettings } from '../shared/voice';
import { isOwner, unauthorized } from './auth';
import type { Env } from './env';
import { json, notAllowed, parseBody, readOr } from './http';
import { redactKey } from '../shared/meta';

const MUSE_KEY = 'muse';
const VOICE_KEY = 'voice';
const SAMPLE = '歡迎來到我的小屋購物車！';

export const connectionsPath = /^\/api\/(muse|voice|voice\/test)$/;

export function connections(storage: DurableObjectStorage, env: Env, http: typeof fetch = fetch) {
  const activity = () => readOr(storage, MUSE_KEY, museActivitySchema, null);
  const voice = (): Promise<VoiceSettings> => readOr(storage, VOICE_KEY, voiceSettingsSchema, emptyVoiceSettings());

  async function handle(request: Request, which: string) {
    if (!isOwner(request, env)) return unauthorized();
    if (which === 'muse') {
      if (request.method !== 'GET') return notAllowed('GET');
      return json({ tokenSet: Boolean(env.CART_MCP_TOKEN), activity: await activity() });
    }
    if (which === 'voice/test') {
      if (request.method !== 'POST') return notAllowed('POST');
      const settings = await voice(), config = voiceConfig(settings);
      if (!config) return json({ error: 'no_voice' }, 409);
      const at = new Date().toISOString();
      try {
        const audio = await speak(config, SAMPLE, http);
        await storage.put(VOICE_KEY, { ...settings, check: { at, ok: true, message: `${audio.byteLength} bytes` } });
        return new Response(audio, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
      } catch (error) {
        const message = redactKey(error, config.apiKey);
        await storage.put(VOICE_KEY, { ...settings, check: { at, ok: false, message } });
        return json({ error: 'voice_failed', message }, 502);
      }
    }
    if (request.method === 'GET') return json(voiceView(await voice()));
    if (request.method !== 'PUT') return notAllowed('GET', 'PUT');
    const body = await parseBody(request, voiceUpdateSchema);
    if (body instanceof Response) return body;
    const next = updateVoice(await voice(), body.data);
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

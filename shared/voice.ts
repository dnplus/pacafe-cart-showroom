import { z } from 'zod';

/**
 * The promo's voice, set from the room's connections panel. The key is stored with the showroom and goes out only to the
 * runner (in its claim, behind the token); the browser gets its last four characters back. Endpoints and fields follow each
 * provider's public REST docs. Charges land on the owner's own account.
 */
export const VOICE_PROVIDERS = ['none', 'minimax', 'elevenlabs'] as const;
export type VoiceProvider = typeof VOICE_PROVIDERS[number];
/** A MiniMax key works only on the platform it came from; the wrong one answers status 1004. */
export const MINIMAX_REGIONS = { global: 'https://api.minimax.io', mainland: 'https://api.minimaxi.com' } as const;
export type MinimaxRegion = keyof typeof MINIMAX_REGIONS;
export const MINIMAX = { model: 'speech-02-hd', voice: 'female-shaonv' } as const;
export const ELEVENLABS = { url: (voiceId: string) => `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, model: 'eleven_multilingual_v2' } as const;

const apiKey = z.string().trim().min(8).max(400);
const voiceId = z.string().trim().max(120);
const region = z.enum(Object.keys(MINIMAX_REGIONS) as [MinimaxRegion, ...MinimaxRegion[]]);

/** What a runner speaks with: one provider and everything it needs. */
export const voiceConfigSchema = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('minimax'), apiKey, voiceId, region }),
  z.strictObject({ provider: z.literal('elevenlabs'), apiKey, voiceId: voiceId.min(1) }),
]);
export type VoiceConfig = z.infer<typeof voiceConfigSchema>;

const check = z.strictObject({ at: z.iso.datetime(), ok: z.boolean(), message: z.string().max(300) });
export const voiceSettingsSchema = z.strictObject({
  provider: z.enum(VOICE_PROVIDERS).default('none'),
  minimax: z.strictObject({ apiKey, voiceId, region }).nullable().default(null),
  elevenlabs: z.strictObject({ apiKey, voiceId: voiceId.min(1) }).nullable().default(null),
  /** The last test from the panel, kept so the panel can say whether the saved key worked. */
  check: check.nullable().default(null),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;
export const emptyVoiceSettings = (): VoiceSettings => voiceSettingsSchema.parse({});

/** The owner's PUT: a key left out keeps the saved one, so the panel never has to hold it. */
export const voiceUpdateSchema = z.strictObject({
  provider: z.enum(VOICE_PROVIDERS),
  minimax: z.strictObject({ apiKey: apiKey.optional(), voiceId, region }).optional(),
  elevenlabs: z.strictObject({ apiKey: apiKey.optional(), voiceId: voiceId.min(1) }).optional(),
});
export type VoiceUpdate = z.infer<typeof voiceUpdateSchema>;

/** The settings after an update, or the provider whose key is still missing. */
export function updateVoice(current: VoiceSettings, update: VoiceUpdate): VoiceSettings | { missing: Exclude<VoiceProvider, 'none'> } {
  const minimaxKey = update.minimax?.apiKey ?? current.minimax?.apiKey, elevenlabsKey = update.elevenlabs?.apiKey ?? current.elevenlabs?.apiKey;
  const minimax = update.minimax && minimaxKey ? { apiKey: minimaxKey, voiceId: update.minimax.voiceId, region: update.minimax.region } : current.minimax;
  const elevenlabs = update.elevenlabs && elevenlabsKey ? { apiKey: elevenlabsKey, voiceId: update.elevenlabs.voiceId } : current.elevenlabs;
  const next = { provider: update.provider, minimax, elevenlabs };
  if (next.provider !== 'none' && !next[next.provider]) return { missing: next.provider };
  // A test only speaks for the voice it tested.
  const config = voiceConfig({ ...next, check: null }), before = voiceConfig(current);
  const same = config && before && Object.entries(config).every(([key, value]) => before[key as keyof typeof before] === value);
  return { ...next, check: same ? current.check : null };
}

/** The voice the runner uses, or null for none (the runner then follows its own TTS_PROVIDER). */
export function voiceConfig(settings: VoiceSettings): VoiceConfig | null {
  if (settings.provider === 'minimax' && settings.minimax) return { provider: 'minimax', ...settings.minimax };
  if (settings.provider === 'elevenlabs' && settings.elevenlabs) return { provider: 'elevenlabs', ...settings.elevenlabs };
  return null;
}

const keyEnd = (key: string) => `…${key.slice(-4)}`;
/** What the browser sees: never a key, only its last four characters. */
export function voiceView(settings: VoiceSettings) {
  return {
    provider: settings.provider,
    minimax: settings.minimax && { keyEnd: keyEnd(settings.minimax.apiKey), voiceId: settings.minimax.voiceId, region: settings.minimax.region },
    elevenlabs: settings.elevenlabs && { keyEnd: keyEnd(settings.elevenlabs.apiKey), voiceId: settings.elevenlabs.voiceId },
    check: settings.check,
  };
}
export type VoiceView = ReturnType<typeof voiceView>;

const minimaxReply = z.object({ data: z.object({ audio: z.string().regex(/^[0-9a-f]*$/) }).nullable().optional(), base_resp: z.object({ status_code: z.number(), status_msg: z.string() }) });
const hexBytes = (hex: string) => { const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return bytes; };

async function audioOrThrow(response: Response, provider: string) {
  if (!response.ok) throw new Error(`${provider} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

/** Speaks `text` with `config`; mp3 bytes, or an error carrying the provider's own status and message. */
export async function speak(config: VoiceConfig, text: string, http: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  if (config.provider === 'elevenlabs') {
    const response = await audioOrThrow(await http(ELEVENLABS.url(config.voiceId), {
      method: 'POST', headers: { 'xi-api-key': config.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: ELEVENLABS.model }),
    }), 'ElevenLabs');
    return new Uint8Array(await response.arrayBuffer());
  }
  const response = await audioOrThrow(await http(`${MINIMAX_REGIONS[config.region]}/v1/t2a_v2`, {
    method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MINIMAX.model, text, stream: false, voice_setting: { voice_id: config.voiceId || MINIMAX.voice, speed: 1, vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 } }),
  }), 'MiniMax');
  const reply = minimaxReply.parse(await response.json());
  if (reply.base_resp.status_code !== 0 || !reply.data?.audio) throw new Error(`MiniMax status ${reply.base_resp.status_code}: ${reply.base_resp.status_msg}`);
  return hexBytes(reply.data.audio);
}

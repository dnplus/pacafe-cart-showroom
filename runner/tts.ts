import { z } from 'zod';
import type { Storyboard, VoiceClip } from './storyboard.ts';

/**
 * Bring-your-own-key voices. Endpoints and fields follow each provider's public REST docs and have not been run against
 * the real APIs. Their charges land on the owner's own account, so they add nothing to the job's costUsd.
 */
export const ELEVENLABS = { url: (voiceId: string) => `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, model: 'eleven_multilingual_v2' } as const;
export const MINIMAX = { url: 'https://api.minimax.io/v1/t2a_v2', model: 'speech-02-hd', voice: 'female-shaonv' } as const;

type Env = Readonly<Record<string, string | undefined>>;
/** Speaks one scene's words; returns mp3 bytes. */
type Speak = (text: string) => Promise<Uint8Array>;

async function audioOrThrow(response: Response, provider: string) {
  if (!response.ok) throw new Error(`${provider} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response;
}

const minimaxReply = z.object({ data: z.object({ audio: z.string().regex(/^[0-9a-f]+$/) }).nullable().optional(), base_resp: z.object({ status_code: z.number(), status_msg: z.string() }) });

export const TTS_PROVIDERS = {
  none: { needs: [], speak: () => null },
  elevenlabs: {
    needs: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'],
    speak: (env: Env, http: typeof fetch): Speak => async text => {
      const response = await audioOrThrow(await http(ELEVENLABS.url(env.ELEVENLABS_VOICE_ID!), {
        method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: ELEVENLABS.model }),
      }), 'ElevenLabs');
      return new Uint8Array(await response.arrayBuffer());
    },
  },
  minimax: {
    needs: ['MINIMAX_API_KEY'],
    speak: (env: Env, http: typeof fetch): Speak => async text => {
      const response = await audioOrThrow(await http(MINIMAX.url, {
        method: 'POST', headers: { authorization: `Bearer ${env.MINIMAX_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MINIMAX.model, text, stream: false, voice_setting: { voice_id: env.MINIMAX_VOICE_ID || MINIMAX.voice, speed: 1, vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 } }),
      }), 'MiniMax');
      const reply = minimaxReply.parse(await response.json());
      if (reply.base_resp.status_code !== 0 || !reply.data) throw new Error(`MiniMax status ${reply.base_resp.status_code}: ${reply.base_resp.status_msg}`);
      return Uint8Array.from(Buffer.from(reply.data.audio, 'hex'));
    },
  },
} as const satisfies Record<string, { needs: readonly string[]; speak: (env: Env, http: typeof fetch) => Speak | null }>;
export type TtsName = keyof typeof TTS_PROVIDERS;
export const ttsNameSchema = z.enum(Object.keys(TTS_PROVIDERS) as [TtsName, ...TtsName[]]);

export interface Tts { name: TtsName; voice(storyboard: Storyboard): Promise<VoiceClip[]> }

/**
 * The provider TTS_PROVIDER names (default none). One whose keys are missing runs as none and says so, naming the variables,
 * never their values. Clips are kept by text, so asking again after a QA fix only speaks the scenes whose words changed.
 */
export function selectTts(env: Env, http: typeof fetch, log: (line: string) => void): Tts {
  const asked = ttsNameSchema.parse(env.TTS_PROVIDER || 'none');
  const missing = TTS_PROVIDERS[asked].needs.filter(name => !env[name]);
  if (missing.length) log(`TTS_PROVIDER=${asked} 但沒有設定 ${missing.join('、')}，改用 none：只出字幕，不配音。`);
  const name: TtsName = missing.length ? 'none' : asked;
  const speak = TTS_PROVIDERS[name].speak(env, http);
  if (!speak) return { name, voice: async () => [] };
  const spoken = new Map<string, Promise<string>>();
  return {
    name,
    voice: storyboard => Promise.all(storyboard.scenes.map(async scene => {
      const text = scene.subtitle.join(' ');
      if (!spoken.has(text)) spoken.set(text, speak(text).then(bytes => `data:audio/mpeg;base64,${Buffer.from(bytes).toString('base64')}`));
      return { sceneId: scene.id, src: await spoken.get(text)! };
    })),
  };
}

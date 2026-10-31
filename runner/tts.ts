import { parseMedia } from '@remotion/media-parser';
import { z } from 'zod';
import { MINIMAX_REGIONS, speak, type MinimaxRegion, type VoiceConfig } from '../shared/voice.ts';
import type { Storyboard, VoiceClip } from './storyboard.ts';

/** Charges land on the owner's own account, so they add nothing to the job's costUsd. */
type Env = Readonly<Record<string, string | undefined>>;

const NEEDS = { none: [], elevenlabs: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'], minimax: ['MINIMAX_API_KEY'] } as const;
export type TtsName = keyof typeof NEEDS;
export const ttsNameSchema = z.enum(Object.keys(NEEDS) as [TtsName, ...TtsName[]]);

export interface Tts { name: TtsName; voice(storyboard: Storyboard): Promise<VoiceClip[]> }

/** Clips are kept by text, so asking again after a QA fix only speaks the scenes whose words changed. */
export function ttsFor(config: VoiceConfig | null, http: typeof fetch): Tts {
  if (!config) return { name: 'none', voice: async () => [] };
  const spoken = new Map<string, Promise<Omit<VoiceClip, 'sceneId'>>>();
  return {
    name: config.provider,
    voice: storyboard => Promise.all(storyboard.scenes.map(async scene => {
      const text = scene.subtitle.join(' ');
      if (!spoken.has(text)) spoken.set(text, speak(config, text, http).then(async bytes => ({
        src: `data:audio/mpeg;base64,${Buffer.from(bytes).toString('base64')}`,
        durationSec: (await parseMedia({ src: new Blob([bytes]), fields: { slowDurationInSeconds: true }, acknowledgeRemotionLicense: true, logLevel: 'error' })).slowDurationInSeconds,
      })));
      return { sceneId: scene.id, ...await spoken.get(text)! };
    })),
  };
}

/** A provider whose keys are missing runs as none and says so, naming the variables, never their values. MINIMAX_REGION picks global (default) or mainland. */
export function selectTts(env: Env, http: typeof fetch, log: (line: string) => void): Tts {
  const asked = ttsNameSchema.parse(env.TTS_PROVIDER || 'none');
  const missing = NEEDS[asked].filter(name => !env[name]);
  if (missing.length) log(`TTS_PROVIDER=${asked} 但沒有設定 ${missing.join('、')}，改用 none：只出字幕，不配音。`);
  const name: TtsName = missing.length ? 'none' : asked;
  const region: MinimaxRegion = env.MINIMAX_REGION && Object.hasOwn(MINIMAX_REGIONS, env.MINIMAX_REGION) ? env.MINIMAX_REGION as MinimaxRegion : 'global';
  return ttsFor(name === 'minimax' ? { provider: 'minimax', apiKey: env.MINIMAX_API_KEY!, voiceId: env.MINIMAX_VOICE_ID ?? '', region }
    : name === 'elevenlabs' ? { provider: 'elevenlabs', apiKey: env.ELEVENLABS_API_KEY!, voiceId: env.ELEVENLABS_VOICE_ID! } : null, http);
}

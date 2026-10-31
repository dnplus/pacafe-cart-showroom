import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';
import { z } from 'zod';
import { museStatusSchema, type MuseStatus } from '../../shared/muse';
import { MINIMAX_REGIONS, VOICE_PROVIDERS, type MinimaxRegion, type VoiceProvider, type VoiceView } from '../../shared/voice';
import { t } from '../i18n';
import { Panel } from '../share/Panel';
import type { TextKey } from '../i18n/messages';
import { failureSchema, ownerFetch, ownerKey } from '../owner';
import '../share/share.css';
import './connect.css';

const POLL_MS = 3000;
const LIVE_MS = 10 * 60 * 1000;

function ago(at: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 60) return t('{count} s ago', { count: seconds });
  if (seconds < 3600) return t('{count} min ago', { count: Math.round(seconds / 60) });
  return t('{count} h ago', { count: Math.round(seconds / 3600) });
}

function useMuse(onSeen: () => void) {
  const [status, setStatus] = useState<MuseStatus | null>(null);
  const last = useRef<string | null | undefined>(undefined), seen = useRef(onSeen);
  useEffect(() => { seen.current = onSeen; });
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await ownerFetch('/api/muse', { signal: controller.signal });
        if (!response.ok) return;
        const next = museStatusSchema.parse(await response.json()), at = next.activity?.lastSeenAt ?? null;
        if (last.current !== undefined && at && at !== last.current) seen.current();
        last.current = at; setStatus(next);
      } catch { /* the next tick tries again */ }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  return status;
}

function CopyRow({ id, label, value, shown = value, multiline = false }: { id: string; label: TextKey; value: string; shown?: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.select(); }
  };
  return <div className="share-field">
    <label htmlFor={id}>{t(label)}</label>
    <div className={multiline ? 'share-row connect-stack' : 'share-row'}>
      {multiline ? <textarea id={id} value={shown} readOnly wrap="off" rows={shown.split('\n').length} onFocus={event => event.currentTarget.select()} /> : <input id={id} value={shown} readOnly onFocus={event => event.currentTarget.select()} />}
      <button type="button" className="share-button" onClick={() => void copy()} data-testid={`${id}-copy`}>{copied ? <Check size={16} /> : <Copy size={16} />}{t(copied ? 'Copied' : 'Copy')}</button>
    </div>
  </div>;
}

function museSettings(origin: string, key: string | null) {
  const settings = (token: string) => JSON.stringify({ mcp_servers: { showroom: { transport: 'streamable_http', url: `${origin}/mcp`, headers: { Authorization: `Bearer ${token}` }, enabled: true, mode: 'required' } } }, null, 2);
  return { value: settings(key ?? '${CART_MCP_TOKEN}'), shown: settings(key ? '••••••••' : '${CART_MCP_TOKEN}') };
}

function MuseSection({ onSeen }: { onSeen: () => void }) {
  const status = useMuse(onSeen), [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const activity = status?.activity ?? null, live = activity && now - Date.parse(activity.lastSeenAt) < LIVE_MS;
  const key = ownerKey(), settings = museSettings(location.origin, key);
  return <section className="connect-section" aria-labelledby="connect-muse-title" data-testid="connect-muse">
    <h3 id="connect-muse-title">{t('Your clerk, Muse')}</h3>
    <p className={live ? 'connect-status is-live' : 'connect-status'} role="status" data-testid="muse-status" data-live={Boolean(live)}>
      <i aria-hidden="true" />
      {!status ? t('Checking…') : !activity ? t('Muse has not connected yet.') : live ? t('Muse is connected') : t('Muse was last here {when}', { when: ago(activity.lastSeenAt, now) })}
      {activity && <small>
        {[activity.client && `${activity.client.name} ${activity.client.version}`.trim(), live && ago(activity.lastSeenAt, now), activity.lastTool && t('last used {tool}', { tool: activity.lastTool.name })].filter(Boolean).join(' · ')}
      </small>}
    </p>
    {status && !status.tokenSet && <p className="cart-note cart-offline">{t('The server has no CART_MCP_TOKEN, so Muse cannot sign in. Set it with wrangler secret put CART_MCP_TOKEN.')}</p>}
    <ol className="connect-steps">
      <li><CopyRow id="connect-url" label="1. Showroom address (MCP)" value={`${location.origin}/mcp`} /></li>
      <li>
        <CopyRow id="connect-settings" label="2. Add to Muse Code's mcp_servers" value={settings.value} shown={settings.shown} multiline />
        <small className="share-hint">{t(key ? 'The copy includes the owner key saved in this browser.' : 'Set CART_MCP_TOKEN on the computer running Muse Code to the same token as the server.')}</small>
      </li>
      <li><p className="connect-step-text">{t('3. Give Muse the showroom-cart and showroom-promo skills from .agents/skills/ in this project.')}</p></li>
      <li>
        <CopyRow id="connect-try" label="4. Say this to Muse to try it" value={t('Use cart_list from the showroom-cart skill to look at my cart showroom, and tell me how many items there are and the total.')} />
        <small className="share-hint">{t('When Muse calls, the light above turns green and the clerk waves.')}</small>
      </li>
    </ol>
  </section>;
}

const providerText: Record<VoiceProvider, { name: TextKey; hint: TextKey }> = {
  none: { name: 'No voice', hint: 'Subtitles only. The runner may still use its own TTS_PROVIDER.' },
  minimax: { name: 'MiniMax', hint: 'speech-02-hd; leave the voice empty for female-shaonv.' },
  elevenlabs: { name: 'ElevenLabs', hint: 'eleven_multilingual_v2; needs a voice ID.' },
};

const voiceViewSchema = z.object({
  provider: z.enum(VOICE_PROVIDERS),
  minimax: z.object({ keyEnd: z.string(), voiceId: z.string(), region: z.enum(Object.keys(MINIMAX_REGIONS) as [MinimaxRegion, ...MinimaxRegion[]]) }).nullable(),
  elevenlabs: z.object({ keyEnd: z.string(), voiceId: z.string() }).nullable(),
  check: z.object({ at: z.string(), ok: z.boolean(), message: z.string() }).nullable(),
}) satisfies z.ZodType<VoiceView>;

function VoiceSection() {
  const [view, setView] = useState<VoiceView | null>(null);
  const [provider, setProvider] = useState<VoiceProvider>('none');
  const [keys, setKeys] = useState({ minimax: '', elevenlabs: '' });
  const [voices, setVoices] = useState({ minimax: '', elevenlabs: '' });
  const [region, setRegion] = useState<MinimaxRegion>('global');
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const show = (next: VoiceView) => {
    setView(next); setProvider(next.provider); setKeys({ minimax: '', elevenlabs: '' });
    setVoices({ minimax: next.minimax?.voiceId ?? '', elevenlabs: next.elevenlabs?.voiceId ?? '' });
    setRegion(next.minimax?.region ?? 'global');
  };
  useEffect(() => {
    void ownerFetch('/api/voice').then(async response => { if (response.ok) show(voiceViewSchema.parse(await response.json())); }, () => setProblem(t('Could not load. Try again.')));
  }, []);
  const save = async () => {
    setBusy(true); setProblem(null); setSaved(false);
    const body = {
      provider,
      ...provider === 'minimax' && { minimax: { voiceId: voices.minimax.trim(), region, ...keys.minimax.trim() && { apiKey: keys.minimax.trim() } } },
      ...provider === 'elevenlabs' && { elevenlabs: { voiceId: voices.elevenlabs.trim(), ...keys.elevenlabs.trim() && { apiKey: keys.elevenlabs.trim() } } },
    };
    try {
      const response = await ownerFetch('/api/voice', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (response.ok) { show(voiceViewSchema.parse(await response.json())); setSaved(true); return; }
      const answer = failureSchema.safeParse(await response.json().catch(() => null)).data ?? {};
      setProblem(t(answer.error === 'missing_key' ? 'Paste the API key first.' : 'Check the key and voice, then save again.'));
    } catch { setProblem(t('Could not save. Try again.')); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setProblem(null);
    try {
      const response = await ownerFetch('/api/voice/test', { method: 'POST' });
      if (response.ok) {
        audio.current?.pause();
        audio.current = new Audio(URL.createObjectURL(await response.blob())); void audio.current.play().catch(() => {});
      } else setProblem(failureSchema.safeParse(await response.json().catch(() => null)).data?.message ?? t('The test did not go through.'));
      // The refreshed view carries the outcome as its last check, so the failure is said once, there.
      const fresh = await ownerFetch('/api/voice'); if (fresh.ok) { setView(voiceViewSchema.parse(await fresh.json())); setProblem(null); }
    } catch { setProblem(t('The test did not go through.')); } finally { setBusy(false); }
  };
  const stored = view && provider !== 'none' ? view[provider] : null, dirty = !view || provider !== view.provider || keys.minimax || keys.elevenlabs
    || (provider === 'minimax' && (voices.minimax !== (view.minimax?.voiceId ?? '') || region !== (view.minimax?.region ?? 'global')))
    || (provider === 'elevenlabs' && voices.elevenlabs !== (view.elevenlabs?.voiceId ?? ''));
  return <section className="connect-section" aria-labelledby="connect-voice-title" aria-busy={busy} data-testid="connect-voice">
    <h3 id="connect-voice-title">{t('Promo voice')}</h3>
    {!view ? <p className="cart-note" role="status">{problem ?? t('Loading…')}</p> : <>
      <fieldset className="share-prices" disabled={busy}>
        <legend>{t('Who reads the promo')}</legend>
        {VOICE_PROVIDERS.map(name => <label key={name} className="share-choice">
          <input type="radio" name="voice-provider" value={name} checked={provider === name} onChange={() => setProvider(name)} />
          <span><strong>{t(providerText[name].name)}</strong><small>{t(providerText[name].hint)}</small></span>
        </label>)}
      </fieldset>
      {provider !== 'none' && <div className="connect-fields">
        <div className="share-field">
          <label htmlFor="voice-key">{t('API key')}</label>
          <input id="voice-key" type="password" autoComplete="off" value={keys[provider]} disabled={busy} placeholder={stored ? t('Saved, ends in {end}. Paste to replace.', { end: stored.keyEnd.slice(1) }) : ''} onChange={event => { const value = event.currentTarget.value; setKeys(current => ({ ...current, [provider]: value })); }} data-testid="voice-key" />
        </div>
        <div className="share-field">
          <label htmlFor="voice-id">{t(provider === 'minimax' ? 'Voice (optional)' : 'Voice ID')}</label>
          <input id="voice-id" value={voices[provider]} disabled={busy} placeholder={provider === 'minimax' ? 'female-shaonv' : ''} onChange={event => { const value = event.currentTarget.value; setVoices(current => ({ ...current, [provider]: value })); }} />
        </div>
        {provider === 'minimax' && <div className="share-field">
          <label htmlFor="voice-region">{t('Platform')}</label>
          <select id="voice-region" value={region} disabled={busy} onChange={event => setRegion(event.currentTarget.value as MinimaxRegion)}>
            <option value="global">{t('International (minimax.io)')}</option>
            <option value="mainland">{t('Mainland China (minimaxi.com)')}</option>
          </select>
          <small className="share-hint">{t('Pick the platform the key came from; the other one answers 1004.')}</small>
        </div>}
      </div>}
      <div className="share-actions">
        <button type="button" className="share-button primary" disabled={busy || !dirty} onClick={() => void save()} data-testid="voice-save">{t('Save')}</button>
        {view.provider !== 'none' && !dirty && <button type="button" className="share-button" disabled={busy} onClick={() => void test()} data-testid="voice-test"><Play size={16} />{t('Play a test line')}</button>}
      </div>
      {saved && !dirty && <p className="share-hint" role="status">{t('Saved. The next promo uses this voice.')}</p>}
      {view.check && !dirty && <p className={view.check.ok ? 'share-hint connect-ok' : 'share-hint share-problem'} data-testid="voice-check">{view.check.ok ? t('Last test worked.') : t('Last test failed: {message}', { message: view.check.message })}</p>}
      {problem && <p className="cart-note cart-offline" role="alert">{problem}</p>}
      <p className="share-hint">{t('The key is kept with this showroom and only handed to your runner; this page shows its last four characters.')}</p>
    </>}
  </section>;
}

export function ConnectionsPanel({ close, onMuseSeen }: { close: () => void; onMuseSeen: () => void }) {
  return <Panel name="connect" className="connect-panel" title={t('Connections')} close={close}>
    <MuseSection onSeen={onMuseSeen} />
    <VoiceSection />
  </Panel>;
}

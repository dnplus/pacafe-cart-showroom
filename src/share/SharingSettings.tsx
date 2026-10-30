import { useEffect, useRef, useState, type RefObject } from 'react';
import { Check, Copy, Download, ExternalLink, X } from 'lucide-react';
import { z } from 'zod';
import type { Cart } from '../../shared/cart';
import { NICKNAME_MAX, priceModes, shareSettingsSchema, shareUpdateSchema, shareView, type PriceMode, type ShareSettings, type ShareUpdate } from '../../shared/share';
import { t } from '../i18n';
import type { TextKey } from '../i18n/messages';
import { ownerFetch } from '../owner';
import type { RoomControls } from '../room/RoomScene';
import { shootCard } from './shareCard';
import './share.css';

const ownerShareSchema = shareSettingsSchema.extend({ url: z.url() });
type OwnerShare = z.infer<typeof ownerShareSchema>;
const modeText: Record<PriceMode, { name: TextKey; hint: TextKey }> = {
  hidden: { name: 'Hide prices', hint: 'Titles, pictures and quantities only: no price and no total.' },
  range: { name: 'Price ranges', hint: 'Each item and the total as a range, such as NT$ 300–500.' },
  exact: { name: 'Exact prices', hint: 'Every price and the total, as you see them.' },
};

async function answer(response: Response) {
  if (!response.ok) throw new Error(`/api/share answered ${response.status}`);
  return ownerShareSchema.parse(await response.json());
}

/** The owner's sharing choices, saved as they change. `onPreview` gets the settings the room should draw a visitor's shelf from, and null on close. */
export function SharingSettings({ cart, controls, onPreview, close }: { cart: Cart | null; controls: RefObject<RoomControls | null>; onPreview: (settings: ShareSettings | null) => void; close: () => void }) {
  const [share, setShare] = useState<OwnerShare | null>(null);
  const [nickname, setNickname] = useState('');
  const [problem, setProblem] = useState<TextKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const preview = useRef(onPreview);
  useEffect(() => { preview.current = onPreview; });
  const show = (next: OwnerShare) => { setShare(next); setNickname(next.nickname); preview.current(next); };

  useEffect(() => {
    let live = true;
    ownerFetch('/api/share').then(answer).then(next => { if (live) { show(next); setProblem(null); } }, error => { if (live) { console.warn(error); setProblem('Could not load the share settings.'); } });
    return () => { live = false; };
  }, [attempt]);
  useEffect(() => () => preview.current(null), []);

  const save = async (change: Partial<ShareUpdate>) => {
    if (!share) return;
    setBusy(true); setProblem(null);
    try {
      const body = shareUpdateSchema.parse({ enabled: share.enabled, prices: share.prices, nickname: share.nickname, ...change });
      show(await answer(await ownerFetch('/api/share', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })));
    } catch (error) { console.warn(error); setProblem('Could not save. Try again.'); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { document.querySelector<HTMLInputElement>('#share-url')?.select(); }
  };
  const download = async () => {
    if (!share || !cart) return;
    const card = await shootCard(controls.current, shareView(cart, share));
    if (!card) { setProblem('The room is not ready for a picture yet.'); return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(card); link.download = 'pacafe-cart-showroom-share.jpg'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  };

  const typed = nickname.trim(), nicknameOk = typed.length >= 1 && typed.length <= NICKNAME_MAX;
  return <section className="share-panel" id="share-panel" aria-labelledby="share-title" aria-busy={busy} data-testid="share-panel">
    <header className="share-panel-head">
      <h2 id="share-title">{t('Share this cart')}</h2>
      <button type="button" className="share-icon-button" onClick={close} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
    </header>
    {!share ? problem ? <p className="cart-note cart-offline" role="alert">{t(problem)} <button type="button" className="share-text-button" onClick={() => setAttempt(count => count + 1)}>{t('Try again')}</button></p> : <p className="cart-note" role="status">{t('Loading…')}</p> : <>
      <label className="share-switch">
        <span>{t('Sharing on')}</span>
        <input type="checkbox" role="switch" checked={share.enabled} disabled={busy} onChange={event => void save({ enabled: event.currentTarget.checked })} data-testid="share-enabled" />
      </label>
      <fieldset className="share-prices" disabled={busy}>
        <legend>{t('Prices visitors see')}</legend>
        {priceModes.map(mode => <label key={mode} className="share-choice">
          <input type="radio" name="share-prices" value={mode} checked={share.prices === mode} onChange={() => void save({ prices: mode })} />
          <span><strong>{t(modeText[mode].name)}</strong><small>{t(modeText[mode].hint)}</small></span>
        </label>)}
      </fieldset>
      <form className="share-field" onSubmit={event => { event.preventDefault(); if (nicknameOk && typed !== share.nickname) void save({ nickname: typed }); }}>
        <label htmlFor="share-nickname">{t('Nickname')}</label>
        <div className="share-row">
          <input id="share-nickname" value={nickname} maxLength={NICKNAME_MAX + 8} disabled={busy} aria-invalid={!nicknameOk} aria-describedby="share-nickname-note" onChange={event => setNickname(event.currentTarget.value)} />
          <button type="submit" className="share-button primary" disabled={busy || !nicknameOk || typed === share.nickname}>{t('Save')}</button>
        </div>
        <small id="share-nickname-note" className={nicknameOk ? 'share-hint' : 'share-hint share-problem'}>{nicknameOk ? t("{nickname}'s cart showroom", { nickname: typed }) : t('Use 1–24 characters.')}</small>
      </form>
      <div className="share-field">
        <label htmlFor="share-url">{t('Share link')}</label>
        <div className="share-row">
          <input id="share-url" value={share.url} readOnly onFocus={event => event.currentTarget.select()} data-testid="share-url" />
          <button type="button" className="share-button" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{t(copied ? 'Copied' : 'Copy')}</button>
        </div>
        {!share.enabled && <small className="share-hint share-off" role="status">{t('Sharing is off. Visitors who open the link see a 404.')}</small>}
      </div>
      <div className="share-actions">
        {share.enabled && <a className="share-button" href={share.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={16} />{t('Preview')}</a>}
        <button type="button" className="share-button" disabled={!cart} onClick={() => void download()}><Download size={16} />{t('Download share card')}</button>
      </div>
      {problem && <p className="cart-note cart-offline" role="alert">{t(problem)}</p>}
      <p className="cart-note">{t('While this panel is open, the room shows what visitors see.')}</p>
    </>}
  </section>;
}

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, MessagesSquare, SendHorizontal, Wrench, X } from 'lucide-react';
import type { ClerkView } from '../../shared/clerk';
import { getLocale, t } from '../i18n';
import type { TextKey } from '../i18n/messages';
import { ownerFetch } from '../owner';
import '../share/share.css';
import './clerk.css';

const SUGGESTIONS: TextKey[] = ['What is on my shelf?', 'I took some things out. Remember my taste.', 'How do I spend?', 'Make an intro video of my cart.'];
const usd = (value: number) => `$${value.toFixed(value < 0.1 ? 3 : 2)}`;

function useClerk(onActed: () => void) {
  const [view, setView] = useState<ClerkView | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const acted = useRef(onActed);
  useEffect(() => { acted.current = onActed; });
  useEffect(() => {
    ownerFetch('/api/clerk').then(async response => { if (response.ok) setView(await response.json()); else setProblem(t('Could not reach the clerk.')); }, () => setProblem(t('Could not reach the clerk.')));
  }, []);
  const call = async (path: string, init: RequestInit) => {
    const response = await ownerFetch(path, { ...init, headers: { 'content-type': 'application/json' } });
    const body: (Partial<ClerkView> & { error?: string; message?: string }) | null = await response.json().then(value => value as object, () => null);
    if (body?.turns) setView(body as ClerkView);
    return { ok: response.ok, body };
  };
  const send = async (message: string) => {
    setPending(message); setProblem(null);
    try {
      const { ok, body } = await call('/api/clerk', { method: 'POST', body: JSON.stringify({ message, language: getLocale() }) });
      if (!ok) setProblem(body?.error === 'daily_limit' ? t('Today\'s free turns are used up. Paste your own Meta API key below to keep talking.') : body?.error === 'no_key' ? t('This showroom has no Meta API key yet. Paste your own below.') : body?.error === 'busy' ? t('Muse is still on the last message.') : t('Muse could not answer: {message}', { message: body?.message ?? body?.error ?? '?' }));
      acted.current();
      return ok;
    } catch { setProblem(t('Could not reach the clerk.')); return false; }
    finally { setPending(null); }
  };
  const saveKey = (apiKey: string) => call('/api/clerk/key', { method: 'PUT', body: JSON.stringify({ apiKey }) });
  const dropKey = () => call('/api/clerk/key', { method: 'DELETE' });
  const clear = () => call('/api/clerk', { method: 'DELETE' });
  return { view, pending, problem, send, saveKey, dropKey, clear };
}

function Status({ view }: { view: ClerkView }) {
  if (view.ready === 'own') return <p className="clerk-meter" data-testid="clerk-meter">{t('Using your Meta key {end}', { end: view.ownKey?.keyEnd ?? '' })}</p>;
  if (view.ready === 'house') return <p className="clerk-meter" data-testid="clerk-meter"><span style={{ ['--used' as string]: `${Math.min(100, view.spentUsd / view.limitUsd * 100)}%` }} />{t('Today {spent} of {limit} on the house key', { spent: usd(view.spentUsd), limit: usd(view.limitUsd) })}</p>;
  return null;
}

function KeyForm({ view, save, drop }: { view: ClerkView; save: (key: string) => Promise<{ ok: boolean }>; drop: () => Promise<unknown> }) {
  const [key, setKey] = useState(''), [failed, setFailed] = useState(false);
  const needed = view.ready === 'no_key' || view.ready === 'daily_limit';
  return <details className="clerk-key" open={needed} data-testid="clerk-key">
    <summary>{t('Use your own Meta API key')}</summary>
    <form onSubmit={async event => { event.preventDefault(); const { ok } = await save(key); setFailed(!ok); if (ok) setKey(''); }}>
      <input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder={view.ownKey?.keyEnd ?? 'Meta API key'} aria-label={t('Meta API key')} />
      <button type="submit" className="share-button primary" disabled={key.trim().length < 8}>{t('Save')}</button>
      {view.ownKey && <button type="button" className="share-button" onClick={() => void drop()}>{t('Remove')}</button>}
    </form>
    {failed && <p className="share-hint share-problem">{t(view.houseBaseUrl ? 'That key was not saved.' : 'This showroom has no Meta API address set; ask whoever runs it to set META_API_BASE_URL.')}</p>}
    <small className="share-hint">{t('Kept with this showroom and used only for the clerk; this page shows its last four characters.')}</small>
  </details>;
}

export function ClerkPanel({ close, onActed }: { close: () => void; onActed: () => void }) {
  const { view, pending, problem, send, saveKey, dropKey, clear } = useClerk(onActed);
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [view?.turns.length, pending]);
  const submit = async (text: string) => { if (!text.trim() || pending) return; setDraft(''); if (!await send(text.trim())) setDraft(text); };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(draft); } };
  const ready = view && (view.ready === 'own' || view.ready === 'house');
  return <section className="share-panel clerk-panel" id="clerk-panel" aria-labelledby="clerk-title" data-testid="clerk-panel" aria-busy={Boolean(pending)}>
    <header className="share-panel-head">
      <h2 id="clerk-title"><MessagesSquare size={15} aria-hidden="true" />{t('Talk to Muse')}</h2>
      <button type="button" className="share-icon-button" onClick={close} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
    </header>
    <p className="share-hint">{t('Muse runs on {model} with the same cart tools Muse Code uses. Ask her to look, tidy up, or film an intro.', { model: view?.model ?? 'Muse Spark' })}</p>
    {view && <Status view={view} />}
    <ol className="clerk-log" ref={log} aria-live="polite" data-testid="clerk-log">
      {view?.turns.length === 0 && !pending && <li className="clerk-turn is-clerk"><p>{t('Hi! I keep this shelf. What would you like to know?')}</p></li>}
      {view?.turns.map((turn, i) => <li key={`${turn.at}-${i}`} className={`clerk-turn is-${turn.role}`}>
        {turn.calls.length > 0 && <ul className="clerk-calls" aria-label={t('Tools used')}>{turn.calls.map((call, j) => <li key={j} className={call.ok ? '' : 'is-failed'}><Wrench size={11} aria-hidden="true" />{call.name}{call.ok ? <Check size={11} aria-hidden="true" /> : ' !'}</li>)}</ul>}
        <p>{turn.text || '…'}</p>
      </li>)}
      {pending && <>
        <li className="clerk-turn is-owner"><p>{pending}</p></li>
        <li className="clerk-turn is-clerk is-thinking" data-testid="clerk-thinking"><p><i /><i /><i /><span>{t('Muse is working…')}</span></p></li>
      </>}
    </ol>
    {problem && <p className="cart-note cart-offline" role="alert" data-testid="clerk-problem">{problem}</p>}
    <div className="clerk-suggestions">{SUGGESTIONS.map(text => <button key={text} type="button" className="clerk-chip" disabled={!ready || Boolean(pending)} onClick={() => void submit(t(text))}>{t(text)}</button>)}</div>
    <form className="clerk-compose" onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(draft); }}>
      <textarea rows={2} value={draft} maxLength={500} onChange={event => setDraft(event.target.value)} onKeyDown={onKey} placeholder={t('Ask Muse…')} aria-label={t('Message to Muse')} disabled={!ready} data-testid="clerk-input" />
      <button type="submit" className="share-button primary" disabled={!ready || !draft.trim() || Boolean(pending)} aria-label={t('Send')} data-testid="clerk-send"><SendHorizontal size={16} /></button>
    </form>
    {view && <KeyForm view={view} save={saveKey} drop={dropKey} />}
    {view && view.turns.length > 0 && <button type="button" className="clerk-clear" onClick={() => void clear()}>{t('Start over')}</button>}
  </section>;
}

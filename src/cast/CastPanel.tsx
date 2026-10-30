import { useRef, useState } from 'react';
import { Sparkles, Undo2, X } from 'lucide-react';
import { characters } from '../../shared/domain';
import { t } from '../i18n';
import { residentArt } from '../room/residentArt';
import { ownerSilhouette } from '../room/silhouette';
import type { CastController } from './useCast';
import '../share/share.css';
import './cast.css';

/** The owner's cast: which clerk stands behind the counter, and the figure at the room's centre that stands for the owner. */
export function CastPanel({ cast, close }: { cast: CastController; close: () => void }) {
  const { view, spriteUrl, busy, problem } = cast;
  const [photo, setPhoto] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const generated = view?.owner.kind === 'generated';
  const unavailable = view?.spriteGeneration.available === false;
  return <section className="share-panel cast-panel" id="cast-panel" aria-labelledby="cast-title" aria-busy={busy} data-testid="cast-panel">
    <header className="share-panel-head">
      <h2 id="cast-title">{t('Cast')}</h2>
      <button type="button" className="share-icon-button" onClick={close} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
    </header>
    {!view ? <p className="cart-note" role="status">{t('Loading…')}</p> : <>
      <fieldset className="cast-clerks" disabled={busy}>
        <legend>{t('Clerk behind the counter')}</legend>
        <div className="cast-grid">
          {characters.map(character => <label key={character} className="cast-choice" data-character={character}>
            <input type="radio" name="cast-character" value={character} checked={view.character === character} onChange={() => void cast.choose(character)} />
            <img src={residentArt[character].portrait} alt="" width="56" height="56" />
            <span>{t(residentArt[character].label)}</span>
          </label>)}
        </div>
      </fieldset>
      <div className="cast-owner">
        <h3>{t('You, in the middle of the room')}</h3>
        <div className="cast-owner-row">
          <img className="cast-sprite" src={spriteUrl ?? ownerSilhouette} alt={t(generated ? 'Your generated figure' : 'Placeholder figure')} height="112" data-testid="cast-sprite" data-kind={generated ? 'generated' : 'placeholder'} />
          <p className="cart-note">
            {generated ? <strong className="cast-ai" data-testid="cast-ai-label">{t('AI generated (Muse Image)')}</strong> : t('A plain stand-in until you make your own.')}
            <small>{t('Only you see this figure. People who open your share link see the stand-in.')}</small>
          </p>
        </div>
        <div className="share-field">
          <label htmlFor="cast-photo">{t('A photo of you (JPEG or PNG, up to 2 MB)')}</label>
          <input id="cast-photo" ref={picker} type="file" accept="image/jpeg,image/png" disabled={busy || unavailable} onChange={event => setPhoto(event.currentTarget.files?.[0] ?? null)} />
        </div>
        <label className="cast-consent">
          <input type="checkbox" checked={consent} disabled={busy || unavailable} onChange={event => setConsent(event.currentTarget.checked)} data-testid="cast-consent" />
          <span>{t('This is me, and I agree to use this photo to make a figure')}</span>
        </label>
        <div className="share-actions">
          <button type="button" className="share-button primary" disabled={busy || unavailable || !photo || !consent} onClick={() => {
            if (photo) void cast.generate(photo).then(() => { setPhoto(null); setConsent(false); if (picker.current) picker.current.value = ''; });
          }} data-testid="cast-generate"><Sparkles size={16} aria-hidden="true" />{t(busy ? 'Drawing…' : 'Ask Muse to draw it')}</button>
          {generated && <button type="button" className="share-button" disabled={busy} onClick={() => void cast.reset()} data-testid="cast-reset"><Undo2 size={16} aria-hidden="true" />{t('Back to the stand-in')}</button>}
        </div>
        {unavailable && <p className="cart-note cast-needs" role="status" data-testid="cast-needs-key">{t('Needs META_API_KEY and META_API_BASE_URL on the server (set them with wrangler secret put).')}</p>}
        <p className="cart-note">{t('The photo is only sent to make the figure and is never kept. The figure is AI generated, and image search is switched off for it.')}</p>
      </div>
      {problem && <p className="cart-note cart-offline" role="alert">{t(problem)}</p>}
    </>}
  </section>;
}

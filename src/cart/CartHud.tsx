import { useRef, useState, type ReactNode } from 'react';
import { Cable, ChartNoAxesColumn, ChevronDown, ChevronUp, Clapperboard, ExternalLink, KeyRound, MessagesSquare, RotateCcw, Share2, ShoppingBasket, Sticker, Trash2, Undo2, UsersRound } from 'lucide-react';
import { cartView, formatTwd } from '../../shared/cart';
import { REMOVAL_REASONS, type RemovalReason } from '../../shared/removals';
import type { TextKey } from '../i18n/messages';
import { t } from '../i18n';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { hasOwnerKey } from '../owner';
import { categoryLabel } from './category';
import { ProductThumb } from './ProductThumb';
import type { CartState } from './useCart';
import type { RemovalController } from './useRemoval';
import { useFlashedLine, type ProductFocus } from './useProductPoke';
import './cart.css';
import './stickers.css';

const reasonLabels: Record<RemovalReason, TextKey> = { not_my_taste: 'Not my taste', too_expensive: 'Too expensive', already_have: 'Already have it', changed_mind: 'Changed my mind' };

/** The chips under a line the owner is taking out: a reason is optional, and Muse is told it. */
function ReasonPicker({ title, pick, cancel }: { title: string; pick: (reason: RemovalReason | null) => void; cancel: () => void }) {
  return <div className="cart-reasons" role="group" aria-label={t('Why take {title} out?', { title })} data-testid="remove-reasons">
    <p>{t('Why take it out? Muse will see your answer. (optional)')}</p>
    <div className="cart-reason-chips">
      {REMOVAL_REASONS.map(reason => <button type="button" key={reason} onClick={() => pick(reason)} data-testid={`remove-reason-${reason}`}>{t(reasonLabels[reason])}</button>)}
    </div>
    <div className="cart-reason-actions">
      <button type="button" className="cart-reason-plain" onClick={() => pick(null)} data-testid="remove-no-reason">{t('Just remove it')}</button>
      <button type="button" className="cart-reason-plain" onClick={cancel} data-testid="remove-cancel">{t('Cancel')}</button>
    </div>
  </div>;
}

/** Asked for when the worker wants the owner key; the key stays in this browser's localStorage. */
function OwnerKeyForm({ unlock }: { unlock: (key: string) => void }) {
  const [key, setKey] = useState('');
  const [tried] = useState(hasOwnerKey);
  return <form className="cart-key" onSubmit={event => { event.preventDefault(); if (key.trim()) unlock(key); }} data-testid="owner-key-form">
    <label htmlFor="owner-key"><KeyRound size={14} aria-hidden="true" />{t('Owner key')}</label>
    <p className="cart-note">{t(tried ? 'That key did not open the cart. Check it and try again.' : 'This room needs the owner key to show the cart.')}</p>
    <div className="cart-key-row">
      <input id="owner-key" type="password" autoComplete="current-password" value={key} onChange={event => setKey(event.currentTarget.value)} />
      <button type="submit" disabled={!key.trim()}>{t('Save and open')}</button>
    </div>
  </form>;
}

export function CartHud({ state, open, onToggle, unlock, sharing, onShare, casting = false, onCast, habits = false, onHabits, connecting = false, onConnect, talking = false, onTalk, filming = false, onFilm, focus = null, removal, replay, album, children }: { state: CartState; open: boolean; onToggle: () => void; unlock: (key: string) => void; sharing: boolean; onShare: () => void; casting?: boolean; onCast?: () => void; habits?: boolean; onHabits?: () => void; connecting?: boolean; onConnect?: () => void; talking?: boolean; onTalk?: () => void; filming?: boolean; onFilm?: () => void; /** The shelf product last clicked in the room; its line is scrolled into view and flagged. */ focus?: ProductFocus | null; /** Taking lines out of the list; without it the list has no remove controls. */ removal?: RemovalController; /** Parcels already on the shelf can be unboxed again from their line. */ replay?: { shelved: ReadonlySet<string>; start: (id: string) => void }; /** The sticker album button: how many kinds are found, and whether its panel is open. */ album?: { found: number; open: boolean; toggle: () => void }; children?: ReactNode }) {
  const list = useRef<HTMLOListElement>(null);
  const flashed = useFlashedLine(focus, open, () => list.current);
  if (state.status === 'locked') return <aside className="cart-hud" aria-label={t('Cart showroom')} data-testid="cart-hud">
    <header className="cart-hud-head">
      <span className="cart-hud-mark" aria-hidden="true"><ShoppingBasket size={18} /></span>
      <span><strong>{t('Cart showroom')}</strong><small>{t('Things your Muse noted while shopping')}</small></span>
      <LanguageSwitch />
    </header>
    <OwnerKeyForm unlock={unlock} />
  </aside>;
  const all = state.status === 'loading' ? [] : state.cart?.items ?? [], items = removal ? removal.visible(all) : all;
  const view = cartView(items), percent = Math.round(view.fill * 100);
  return <aside className="cart-hud" aria-label={t('Cart showroom')} data-testid="cart-hud" data-count={view.count} data-total={view.totalTwd} data-fill={view.fill}>
    <header className="cart-hud-head">
      <span className="cart-hud-mark" aria-hidden="true"><ShoppingBasket size={18} /></span>
      <span><strong>{t('Cart showroom')}</strong><small>{t('Things your Muse noted while shopping')}</small></span>
      {state.status !== 'loading' && onTalk && <button type="button" className="cart-share cart-talk" aria-expanded={talking} aria-controls="clerk-panel" onClick={onTalk} data-testid="clerk-button"><MessagesSquare size={15} aria-hidden="true" />{t('Talk to Muse')}</button>}
      {state.status !== 'loading' && <button type="button" className="cart-share" aria-expanded={sharing} aria-controls="share-panel" onClick={onShare} data-testid="share-button"><Share2 size={15} aria-hidden="true" />{t('Share')}</button>}
      {state.status !== 'loading' && onCast && <button type="button" className="cart-share" aria-expanded={casting} aria-controls="cast-panel" onClick={onCast} data-testid="cast-button"><UsersRound size={15} aria-hidden="true" />{t('Cast')}</button>}
      {state.status !== 'loading' && onHabits && <button type="button" className="cart-share" aria-expanded={habits} aria-controls="habits-panel" onClick={onHabits} data-testid="habits-button"><ChartNoAxesColumn size={15} aria-hidden="true" />{t('Habits')}</button>}
      {state.status !== 'loading' && album && <button type="button" className="cart-share album-target" aria-expanded={album.open} aria-controls="album-panel" onClick={album.toggle} data-testid="album-button"><Sticker size={15} aria-hidden="true" />{t('Stickers')}{album.found > 0 && <b className="album-badge">{album.found}</b>}</button>}
      {state.status !== 'loading' && onFilm && <button type="button" className="cart-share" aria-expanded={filming} aria-controls="promo-panel" onClick={onFilm} data-testid="promo-button"><Clapperboard size={15} aria-hidden="true" />{t('Promo')}</button>}
      {state.status !== 'loading' && onConnect && <button type="button" className="cart-share" aria-expanded={connecting} aria-controls="connect-panel" onClick={onConnect} data-testid="connect-button"><Cable size={15} aria-hidden="true" />{t('Connections')}</button>}
      <LanguageSwitch />
    </header>
    <dl className="cart-stats">
      <div><dt>{t('Items')}</dt><dd data-testid="hud-count">{view.count}</dd></div>
      <div><dt>{t('Total')}</dt><dd data-testid="hud-total">{formatTwd(view.totalTwd)}</dd></div>
      <div><dt>{t('Shelf filled')}</dt><dd data-testid="hud-fill">{percent}%</dd>
        <span className="cart-fill" role="meter" aria-label={t('Shelf filled')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></span></div>
    </dl>
    {view.overflow > 0 && <p className="cart-note">{t('{count} more do not fit on the shelf', { count: view.overflow })}</p>}
    {state.status === 'loading' && <p className="cart-note" role="status">{t('Loading the cart…')}</p>}
    {state.status === 'offline' && <p className="cart-note cart-offline" role="status">{t('Cannot reach the cart right now. Trying again.')}</p>}
    {state.status !== 'loading' && !view.count && <p className="cart-note">{t('The shelf is empty. What your Muse notes while shopping shows up here.')}</p>}
    {removal && (removal.pending.length > 0 || removal.failed) && <ul className="cart-undo" role="status" aria-live="polite" data-testid="remove-undo">
      {removal.pending.map(({ item }) => <li key={item.id}>
        <span>{t('Removed {title}', { title: item.title })}</span>
        <button type="button" onClick={() => removal.undo(item.id)} data-testid="remove-undo-button"><Undo2 size={14} aria-hidden="true" />{t('Undo')}</button>
      </li>)}
      {removal.failed && <li className="is-failed"><span>{t('Could not remove {title}. It is back on the list.', { title: removal.failed.title })}</span><button type="button" onClick={removal.dismissFailure}>{t('Dismiss')}</button></li>}
    </ul>}
    {view.count > 0 && <button type="button" className="cart-toggle" aria-expanded={open} aria-controls="cart-list" onClick={onToggle}>{open ? t('Hide the list') : t('Show the list')}{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</button>}
    {open && view.count > 0 && <ol className="cart-list" id="cart-list" ref={list} aria-label={t('On the shelf')}>
      {items.map(item => <li key={item.id} data-key={item.id} data-testid="cart-row" className={flashed === item.id ? 'is-flashed' : undefined}>
        <ProductThumb src={item.cutoutUrl ?? item.imageUrl} category={item.category} />
        <span className="cart-line-main">
          {item.url
            ? <a className="cart-line-title cart-line-link" href={item.url} target="_blank" rel="noopener noreferrer" data-testid="cart-row-link">{item.title}<ExternalLink size={12} aria-hidden="true" /></a>
            : <span className="cart-line-title">{item.title}</span>}
          <span className="cart-line-meta">
            {item.store && <small>{item.store}</small>}
            {item.category && <small className="cart-chip" data-category={item.category}>{categoryLabel(item.category)}</small>}
          </span>
        </span>
        <span className="cart-line-price">{item.priceTwd === null ? t('No price') : formatTwd(item.priceTwd)}{item.qty > 1 && <small>×{item.qty}</small>}</span>
        {replay?.shelved.has(item.id) && <button type="button" className="cart-replay" aria-label={t('Unbox {title} again', { title: item.title })} title={t('Unbox again')} onClick={() => replay.start(item.id)} data-testid="cart-replay"><RotateCcw size={15} aria-hidden="true" /></button>}
        {removal && <button type="button" className="cart-remove" aria-label={t('Remove {title}', { title: item.title })} aria-expanded={removal.asking === item.id} onClick={() => removal.ask(removal.asking === item.id ? null : item.id)} data-testid="cart-remove"><Trash2 size={15} aria-hidden="true" /></button>}
        {removal?.asking === item.id && <ReasonPicker title={item.title} pick={reason => removal.confirm(item, reason)} cancel={() => removal.ask(null)} />}
      </li>)}
    </ol>}
    {children}
    <p className="cart-disclaimer">{t('No checkout and no link to Muse shopping: your own Muse does the shopping, this room only shows it.')}</p>
  </aside>;
}

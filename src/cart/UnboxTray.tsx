import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ExternalLink, PackageOpen, Scissors } from 'lucide-react';
import { formatTwd, type CartItem } from '../../shared/cart';
import { t } from '../i18n';
import { ProductThumb } from './ProductThumb';
import { extendSlit, sliceProgress, STAGGERED, type Box, type Slit } from './unbox';
import type { UnboxController } from './useUnbox';
import './unbox-tray.css';

const MINIS = 4;
const PRELOAD = 3;
/** px a finger may stray from the tape's edge and still be cutting it. */
const REACH_PX = 40;
const style = (vars: Record<string, string | number>) => vars as CSSProperties;
const SPARKS = [-70, -40, -12, 14, 42, 72];

/** A parcel drawn in CSS; the same art is the big one on the counter, a small one waiting in line, and the one popping open. */
function Parcel({ box, item, index = 0, variant, quick, children }: { box: Box; item: CartItem; index?: number; variant: 'front' | 'mini' | 'pop'; quick?: boolean; children?: ReactNode }) {
  return <div className={`parcel parcel-${variant}`} data-testid="unbox-box" data-item-id={box.id} data-phase={box.phase} data-progress={box.phase === 'slicing' ? box.progress.toFixed(2) : undefined} data-quick={quick || undefined}
    style={style({ '--p': box.phase === 'slicing' ? box.progress : 0, '--i': Math.min(index, STAGGERED) })} aria-label={variant === 'mini' ? t('Parcel waiting its turn') : undefined}>
    <i className="parcel-inside" /><i className="flap flap-back" /><i className="flap flap-front" />
    <div className="parcel-body">{item.store && <span className="parcel-label">{t('From {store}', { store: item.store })}</span>}</div>
    <div className="parcel-tape" data-testid={variant === 'front' ? 'unbox-tape' : undefined}><i className="parcel-cut" /></div>
    {variant === 'front' && <Scissors className="parcel-scissors" aria-hidden="true" />}
    {variant === 'pop' && SPARKS.map(angle => <i key={angle} className="spark" style={style({ '--a': `${angle}deg` })} />)}
    {children}
  </div>;
}

/** The one parcel on the counter that a finger or mouse can cut open along its tape. */
function FrontParcel({ box, item, index, slice, release }: { box: Box; item: CartItem; index: number } & Pick<UnboxController, 'slice' | 'release'>) {
  const root = useRef<HTMLDivElement>(null);
  const stroke = useRef<{ pointer: number; slit: Slit | null } | null>(null);
  const live = box.phase === 'atCounter' || box.phase === 'slicing';
  const paint = (slit: Slit | null, at?: number) => {
    const css = root.current?.style; if (!css) return;
    css.setProperty('--lo', String(slit?.lo ?? 0)); css.setProperty('--hi', String(slit?.hi ?? 0));
    if (at !== undefined) css.setProperty('--at', String(at));
  };
  const cut = (event: PointerEvent<HTMLDivElement>) => {
    const current = stroke.current, tape = root.current?.querySelector('.parcel-tape');
    if (!current || current.pointer !== event.pointerId || !tape) return;
    const rect = tape.getBoundingClientRect(), along = (event.clientX - rect.left) / rect.width;
    const next = extendSlit(current.slit, { along, off: event.clientY - (rect.top + rect.height / 2) }, rect.height / 2 + REACH_PX);
    const strayed = current.slit && !next;
    current.slit = next; paint(next, along);
    if (next) slice(box.id, sliceProgress(next)); else if (strayed) release(box.id);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (stroke.current?.pointer !== event.pointerId) return;
    stroke.current = null; paint(null); release(box.id);
  };
  return <div className="unbox-hit" ref={root} role="button" tabIndex={live ? 0 : -1} aria-disabled={!live}
    aria-label={t('Parcel: {title}. Swipe along the tape, or press Enter to open it.', { title: item.title })}
    onPointerDown={event => {
      if (!live || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
      stroke.current = { pointer: event.pointerId, slit: null }; cut(event);
    }} onPointerMove={cut} onPointerUp={end} onPointerCancel={end} onContextMenu={event => event.preventDefault()}
    onKeyDown={(event: KeyboardEvent) => { if (live && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); slice(box.id, 1); } }}>
    <Parcel box={box} item={item} index={index} variant="front" />
  </div>;
}

/** Where the product card ends its reveal: the room's shelf, as an offset from where the card sits in its parcel. */
function flyToShelf(node: HTMLElement | null) {
  const shelf = document.querySelector('.shelf-target')?.getBoundingClientRect(), from = node?.parentElement?.getBoundingClientRect();
  if (!node || !shelf?.width || !from) return;
  node.style.setProperty('--fx', `${shelf.left + shelf.width / 2 - (from.left + from.width / 2)}px`);
  node.style.setProperty('--fy', `${shelf.top + shelf.height / 2 - (from.top + node.offsetHeight / 2)}px`);
}

/** What comes out of an opened parcel: its picture (or a tile), title, store, price, and the link to the product page. */
function RevealCard({ item }: { item: CartItem }) {
  const price = item.priceTwd === null ? null : formatTwd(item.priceTwd);
  return <span className="parcel-item" ref={flyToShelf} data-testid="unbox-reveal">
    <ProductThumb src={item.cutoutUrl ?? item.imageUrl} category={item.category} className="parcel-item-pic" eager />
    <b>{item.title}{item.qty > 1 && <small>×{item.qty}</small>}</b>
    <span className="parcel-item-more">
      <span className="parcel-item-from">{item.store && <small>{item.store}</small>}{price && <strong>{price}</strong>}</span>
      {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" data-testid="unbox-reveal-link">{t('View item')}<ExternalLink size={11} aria-hidden="true" /></a>}
    </span>
  </span>;
}

/**
 * Parcels delivered to the counter, shown over the room (not inside it, so a swipe is never taken for the two-finger camera).
 * It leaves once every parcel is shelved.
 */
export function UnboxTray({ boxes, items, ready, saveFailed, slice, release, openAll }: Pick<UnboxController, 'boxes' | 'ready' | 'saveFailed' | 'slice' | 'release' | 'openAll'> & { items: readonly CartItem[] }) {
  const byId = new Map(items.map(item => [item.id, item]));
  // A parcel keeps the reveal it started with: its place in the burst and whether it flew out with others, whatever opens after it.
  const reveals = useRef(new Map<string, { index: number; quick: boolean }>());
  const pending = boxes.filter(box => box.phase !== 'shelved' && byId.has(box.id));
  // The next few pictures are fetched while their parcels are still shut, so the one that comes out is already there.
  const upcoming = pending.slice(0, PRELOAD).map(box => byId.get(box.id)?.cutoutUrl ?? byId.get(box.id)?.imageUrl).filter(Boolean).join('\n');
  useEffect(() => { for (const src of upcoming ? upcoming.split('\n') : []) { const image = new Image(); image.referrerPolicy = 'no-referrer'; image.src = src; } }, [upcoming]);
  if (!ready || !pending.length) return null;
  const popping = pending.filter(box => box.phase === 'opened');
  const fresh = popping.filter(box => !reveals.current.has(box.id));
  fresh.forEach((box, index) => reveals.current.set(box.id, { index: Math.min(index, STAGGERED), quick: fresh.length > 1 }));
  for (const id of reveals.current.keys()) if (!popping.some(box => box.id === id)) reveals.current.delete(id);
  const queue = pending.filter(box => box.phase !== 'opened');
  const [front, ...rest] = queue, minis = rest.slice(0, MINIS), more = rest.length - minis.length;
  return <section className="unbox" data-testid="unbox" data-phase={front?.phase ?? 'opened'} data-pending={queue.length} aria-label={t('Parcels at the counter')}>
    <header className="unbox-head"><strong>{t('Parcels at the counter')}</strong>{front && <small>{t('Swipe along the tape to cut it open')}</small>}</header>
    <div className="unbox-stage">
      {front && <FrontParcel key={front.id} box={front} item={byId.get(front.id)!} index={0} slice={slice} release={release} />}
      <div className="unbox-pop">
        {popping.map(box => <Parcel key={box.id} box={box} item={byId.get(box.id)!} index={reveals.current.get(box.id)!.index} variant="pop" quick={reveals.current.get(box.id)!.quick}>
          <RevealCard item={byId.get(box.id)!} />
        </Parcel>)}
      </div>
    </div>
    {pending.length > 1 && <footer className="unbox-bar">
      <div className="unbox-queue">
        {minis.map((box, i) => <Parcel key={box.id} box={box} item={byId.get(box.id)!} index={i + 1} variant="mini" />)}
        {more > 0 && <span className="unbox-more">+{more}</span>}
      </div>
      {queue.length > 1 && <button type="button" className="unbox-all" onClick={openAll} data-testid="unbox-all"><PackageOpen size={18} aria-hidden="true" />{t('Open all at once ({count})', { count: queue.length })}</button>}
    </footer>}
    {saveFailed && <p className="cart-note cart-offline" role="status">{t('Could not save what you opened. Trying again.')}</p>}
  </section>;
}

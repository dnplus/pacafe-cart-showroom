import { useEffect, useRef, useState, type RefObject } from 'react';
import { PackageOpen, X } from 'lucide-react';
import { rarityOf } from '../../shared/packaging';
import { t } from '../i18n';
import { RevealCard, RevealSticker, style } from './Parcel';
import { createParcelStage, type ParcelStage, type StageParcel } from './parcelStage';
import type { ImageLoader } from './productImage';
import { ProductThumb } from './ProductThumb';
import { Sticker } from './stickers';
import type { TrayItem } from './trayItem';
import type { Box } from './unbox';
import { ExternalLink } from 'lucide-react';
import './unbox-stage.css';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** How long each box shakes before it pops, how much longer a rare or fine one holds the room, and the pause before the results. */
const SHAKE_MS = 460, RARE_MS = 800, FINE_MS = 250, RESULTS_MS = 1000;
const REDUCED_STEP_MS = 160, REDUCED_RESULTS_MS = 300, REDUCED_PUT_MS = 250, PUT_MS = 800;

const stageParcel = (item: TrayItem): StageParcel => ({ id: item.id, packaging: item.packaging, store: item.store, product: { key: item.id, title: item.title, qty: item.qty, price: item.price, image: item.picture } });

/**
 * The 3D stage: its own three.js canvas (separate from the room's) drawing the parcels, and disposed with the component. `autoOpen` plays the first
 * parcel's opening at once; otherwise the owner of `stageRef` calls `open` and `shake`. Without WebGL the canvas stays empty and the cards still show.
 */
function ParcelCanvas({ parcels, mode, loadImage, stageRef, autoOpen = false }: { parcels: readonly StageParcel[]; mode: 'single' | 'pull'; loadImage?: ImageLoader; stageRef?: RefObject<ParcelStage | null>; autoOpen?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stage: ParcelStage | null = null;
    try { stage = createParcelStage(host.current!, parcels, { mode, reduced: reducedMotion(), loadImage, shelf: () => document.querySelector('.shelf-target')?.getBoundingClientRect() ?? null }); } catch (error) { console.warn(error); }
    if (stageRef) stageRef.current = stage;
    if (autoOpen) stage?.open(0);
    return () => { stage?.dispose(); if (stageRef) stageRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="stage-3d" ref={host} data-testid="stage-3d" />;
}

/** One parcel opening in the middle of the room, in 3D: the box, the burst, the product rising out of it, and Muse's note, price and sticker laid over it. */
export function SingleStage({ boxes, byId, loadImage }: { boxes: readonly Box[]; byId: ReadonlyMap<string, TrayItem>; loadImage?: ImageLoader }) {
  const item = byId.get(boxes[0].id)!;
  return <div className="stage-scrim" data-testid="unbox-stage" data-kind="single">
    <div className="stage">
      <ParcelCanvas key={item.id} parcels={[stageParcel(item)]} mode="single" loadImage={loadImage} autoOpen />
      <div className="stage-hud" data-rarity={rarityOf(item.packaging)}>
        {item.note && <p className="stage-note" data-testid="unbox-note"><i aria-hidden="true" />{item.note}</p>}
        <div className="stage-info" data-testid="unbox-reveal">
          <b>{item.title}{item.qty > 1 && <small>×{item.qty}</small>}</b>
          <span>{item.store && <small>{item.store}</small>}{item.price && <strong>{item.price}</strong>}</span>
          {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" data-testid="unbox-reveal-link">{t('View item')}<ExternalLink size={13} aria-hidden="true" /></a>}
        </div>
        <div className="stage-sticker-anchor">{item.packaging.sticker && <RevealSticker id={item.packaging.sticker} />}</div>
      </div>
    </div>
  </div>;
}

/**
 * Parcels opened together, like a multi-pull: they line up, each shakes and pops in turn (a rare one with a sticker gets a golden flash and a longer
 * pause), then the product cards sit in a row to tap and read. "Put them on the shelf" sends them all flying there, and `settle` records them.
 */
export function PullStage({ boxes, byId, settle, loadImage }: { boxes: readonly Box[]; byId: ReadonlyMap<string, TrayItem>; settle: (ids: readonly string[]) => void; loadImage?: ImageLoader }) {
  const ids = useRef(boxes.map(box => box.id)).current, n = ids.length;
  const [step, setStep] = useState(0), [view, setView] = useState<'cascade' | 'results'>('cascade'), [zoom, setZoom] = useState<string | null>(null), [leaving, setLeaving] = useState(false);
  const results = useRef<HTMLDivElement>(null), stage = useRef<ParcelStage | null>(null), [lucky, setLucky] = useState(0);
  const parcels = useRef(ids.map(id => stageParcel(byId.get(id)!))).current;
  // The 3D stage shakes the next parcel and pops the one before it; a rare pull (a sticker inside) also lights up the banner.
  useEffect(() => {
    if (view !== 'cascade') return;
    stage.current?.shake(step < n ? step : null);
    if (step > 0) { stage.current?.open(step - 1); if (rarityOf(byId.get(ids[step - 1])!.packaging) === 'rare') setLucky(count => count + 1); }
  }, [step, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = (id: string) => byId.get(id)!;
  useEffect(() => {
    if (view !== 'cascade') return;
    const reduced = reducedMotion();
    if (step >= n) { const timer = setTimeout(() => setView('results'), reduced ? REDUCED_RESULTS_MS : RESULTS_MS); return () => clearTimeout(timer); }
    const last = step > 0 ? rarityOf(item(ids[step - 1]).packaging) : 'plain';
    const timer = setTimeout(() => setStep(step + 1), reduced ? REDUCED_STEP_MS : SHAKE_MS + (last === 'rare' ? RARE_MS : last === 'fine' ? FINE_MS : 0));
    return () => clearTimeout(timer);
  }, [step, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const put = () => {
    if (leaving) return;
    setLeaving(true);
    const shelf = document.querySelector('.shelf-target')?.getBoundingClientRect();
    results.current?.querySelectorAll<HTMLElement>('.pull-card').forEach(card => {
      const from = card.getBoundingClientRect();
      if (shelf?.width) { card.style.setProperty('--fx', `${shelf.left + shelf.width / 2 - (from.left + from.width / 2)}px`); card.style.setProperty('--fy', `${shelf.top + shelf.height / 2 - (from.top + from.height / 2)}px`); }
    });
    setTimeout(() => settle(ids), reducedMotion() ? REDUCED_PUT_MS : PUT_MS);
  };
  const zoomed = zoom ? item(zoom) : null;
  return <div className="stage-scrim" data-testid="unbox-stage" data-kind="pull" data-view={view} data-leaving={leaving || undefined}>
    {view === 'cascade' ? <div className="pull" data-testid="pull-cascade" data-opened={step}>
      <ParcelCanvas parcels={parcels} mode="pull" loadImage={loadImage} stageRef={stage} />
      {lucky > 0 && <p className="pull-lucky" key={lucky} data-testid="pull-lucky">{t('Lucky pull!')}</p>}
      <button type="button" className="pull-skip" onClick={() => { setStep(n); setView('results'); }} data-testid="pull-skip">{t('Skip')}</button>
    </div> : <div className="pull-results" ref={results} data-testid="pull-results">
      <h2>{t('{count} parcels opened', { count: n })}</h2>
      <p>{t('Tap a card to read it up close.')}</p>
      <ul className="pull-cards">
        {ids.map((id, i) => { const entry = item(id); return <li key={id} style={style({ '--i': i })}>
          <button type="button" className="pull-card" data-rarity={rarityOf(entry.packaging)} onClick={() => setZoom(id)} data-testid="pull-card">
            <ProductThumb src={entry.picture} category={entry.category} className="pull-card-pic" eager />
            <b>{entry.title}{entry.qty > 1 && <small>×{entry.qty}</small>}</b>
            {entry.price && <small className="pull-card-price">{entry.price}</small>}
            {entry.packaging.sticker && <span className="pull-card-sticker"><Sticker id={entry.packaging.sticker} /></span>}
            {entry.note && <span className="pull-card-note" aria-hidden="true">✎</span>}
          </button>
        </li>; })}
      </ul>
      <button type="button" className="pull-done" onClick={put} data-testid="pull-done"><PackageOpen size={20} aria-hidden="true" />{t('Put them on the shelf')}</button>
    </div>}
    {zoomed && <div className="pull-zoom" onClick={() => setZoom(null)} data-testid="pull-zoom">
      <div onClick={event => event.stopPropagation()}>
        <RevealCard item={zoomed} still />
        {zoomed.packaging.sticker && <span className="pull-zoom-sticker"><Sticker id={zoomed.packaging.sticker} /></span>}
        <button type="button" className="pull-zoom-close" onClick={() => setZoom(null)} aria-label={t('Close')}><X size={18} aria-hidden="true" /></button>
      </div>
    </div>}
  </div>;
}

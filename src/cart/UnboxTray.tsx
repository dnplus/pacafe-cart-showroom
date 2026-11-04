import { useEffect, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { PackageOpen, Scissors, X } from 'lucide-react';
import { t } from '../i18n';
import { Parcel, style } from './Parcel';
import { createParcelStage, type ParcelStage } from './parcelStage';
import { shelfColour } from './shelf';
import { PullStage, SingleStage, reducedMotion, stageParcel } from './UnboxStage';
import type { ImageLoader } from './productImage';
import type { TrayItem } from './trayItem';
import { extendSlit, popDuration, sliceProgress, unboxReducer, type Box, type Slit } from './unbox';
import type { UnboxController } from './useUnbox';
import './unbox-tray.css';

const MINIS = 4;
const PRELOAD = 3;
const NONE: ReadonlySet<string> = new Set(), noop = () => {};
/** px a finger may stray from the tape's edge and still be cutting it. */
const REACH_PX = 40;

/** The one parcel on the counter that a finger or mouse can cut open along its tape. It is drawn by a small three.js stage; without WebGL it is the flat CSS parcel. */
function FrontParcel({ box, item, index, slice, release }: { box: Box; item: TrayItem; index: number } & Pick<UnboxController, 'slice' | 'release'>) {
  const root = useRef<HTMLDivElement>(null);
  const stroke = useRef<{ pointer: number; slit: Slit | null } | null>(null);
  const host = useRef<HTMLDivElement>(null), rail = useRef<HTMLElement>(null), stage = useRef<ParcelStage | null>(null), place = useRef(noop);
  const [flat, setFlat] = useState(false);
  const live = box.phase === 'atCounter' || box.phase === 'slicing';
  useEffect(() => {
    // Held here: React clears the ref before this effect's cleanup runs, and a resize can land in between.
    const el = host.current!;
    let made: ParcelStage;
    try { made = createParcelStage(el, [stageParcel(item)], { mode: 'counter', reduced: reducedMotion() }); } catch (error) { console.warn(error); setFlat(true); return; }
    stage.current = made;
    // The scissors ride a rail laid over the projected tape, in fractions of the box so they stay put whatever the box is doing.
    place.current = () => {
      const tape = made.tapeRect(), frame = el.getBoundingClientRect(), css = rail.current?.style; if (!tape || !css || !frame.width) return;
      css.left = `${(tape.left - frame.left) / frame.width * 100}%`; css.top = `${(tape.top - frame.top) / frame.height * 100}%`;
      css.width = `${tape.width / frame.width * 100}%`; css.height = `${tape.height / frame.height * 100}%`; css.visibility = 'visible';
    };
    const observer = new ResizeObserver(() => place.current()); observer.observe(el); place.current();
    return () => { observer.disconnect(); made.dispose(); stage.current = null; place.current = noop; };
  }, []);
  useEffect(() => place.current(), [live]);
  const paint = (slit: Slit | null, at?: number) => {
    stage.current?.cut(slit);
    const css = root.current?.style; if (!css) return;
    css.setProperty('--lo', String(slit?.lo ?? 0)); css.setProperty('--hi', String(slit?.hi ?? 0));
    if (at !== undefined) css.setProperty('--at', String(at));
  };
  const cut = (event: PointerEvent<HTMLDivElement>) => {
    const current = stroke.current, rect = stage.current?.tapeRect() ?? root.current?.querySelector('.parcel-tape')?.getBoundingClientRect();
    if (!current || current.pointer !== event.pointerId || !rect) return;
    const along = (event.clientX - rect.left) / rect.width;
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
    {flat ? <Parcel box={box} item={item} index={index} variant="front" />
      : <div className="parcel parcel-front parcel-3d" data-testid="unbox-box" data-item-id={box.id} data-phase={box.phase} data-tape={item.packaging.tape} data-filler={item.packaging.filler} data-progress={box.phase === 'slicing' ? box.progress.toFixed(2) : undefined}
        style={style({ '--c': shelfColour(item), '--p': box.phase === 'slicing' ? box.progress : 0, '--i': index })}>
        <div className="parcel-host" ref={host} />
        <i className="parcel-rail" ref={rail}><Scissors className="parcel-scissors" aria-hidden="true" /></i>
      </div>}
  </div>;
}

/**
 * Parcels delivered to the counter, shown over the room (not inside it, so a swipe is never taken for the two-finger camera).
 * It leaves once every parcel is shelved.
 */
export function UnboxTray({ boxes, items, ready, saveFailed, slice, release, openAll, replay, held = NONE, settle = noop, loadImage }: Pick<UnboxController, 'boxes' | 'ready' | 'saveFailed' | 'slice' | 'release' | 'openAll'> & Partial<Pick<UnboxController, 'held' | 'settle'>> & { items: readonly TrayItem[]; /** How the 3D stage fetches a product picture for its box; the same loader the room's shelf uses. */ loadImage?: ImageLoader; /** Unboxing something already on the shelf: no write happens, and this closes the tray. */ replay?: () => void }) {
  const byId = new Map(items.map(item => [item.id, item]));
  const pending = boxes.filter(box => box.phase !== 'shelved' && byId.has(box.id));
  // The next few pictures are fetched while their parcels are still shut, so the one that comes out is already there.
  const upcoming = pending.slice(0, PRELOAD).map(box => byId.get(box.id)?.picture).filter(Boolean).join('\n');
  useEffect(() => { for (const src of upcoming ? upcoming.split('\n') : []) { const image = new Image(); image.referrerPolicy = 'no-referrer'; image.src = src; } }, [upcoming]);
  if (!ready || !pending.length) return null;
  const popping = pending.filter(box => box.phase === 'opened'), pulled = popping.filter(box => held.has(box.id)), single = popping.filter(box => !held.has(box.id));
  const queue = pending.filter(box => box.phase !== 'opened');
  const [front, ...rest] = queue, minis = rest.slice(0, MINIS), more = rest.length - minis.length;
  return <>
    <section className="unbox" data-testid="unbox" data-phase={front?.phase ?? 'opened'} data-replay={replay ? '' : undefined} data-staging={popping.length > 0 || undefined} data-pending={queue.length} aria-label={t('Parcels at the counter')}>
      <header className="unbox-head"><strong>{replay ? t('Unbox again') : t('Parcels at the counter')}</strong>{front && <small>{t('Swipe along the tape to cut it open')}</small>}{replay && <button type="button" className="unbox-close" onClick={replay} aria-label={t('Close')} data-testid="unbox-replay-close"><X size={16} aria-hidden="true" /></button>}</header>
      <div className="unbox-stage">
        {front && <FrontParcel key={front.id} box={front} item={byId.get(front.id)!} index={0} slice={slice} release={release} />}
      </div>
      {pending.length > 1 && <footer className="unbox-bar">
        <div className="unbox-queue">
          {minis.map((box, i) => <Parcel key={box.id} box={box} item={byId.get(box.id)!} index={i + 1} variant="mini" />)}
          {more > 0 && <span className="unbox-more">+{more}</span>}
        </div>
        {queue.length > 1 && <button type="button" className="unbox-all" onClick={openAll} data-testid="unbox-all"><PackageOpen size={18} aria-hidden="true" />{t('Open all at once ({count})', { count: queue.length })}</button>}
      </footer>}
      {saveFailed && <p className="cart-note cart-offline" role="status">{t('Could not save what you opened. Trying again.')}</p>}
    </section>
    {single.length > 0 && <SingleStage boxes={single} byId={byId} loadImage={loadImage} />}
    {pulled.length > 0 && <PullStage boxes={pulled} byId={byId} settle={settle} loadImage={loadImage} />}
  </>;
}

export function ReplayTray({ item, done, loadImage }: { item: TrayItem; done: () => void; loadImage?: ImageLoader }) {
  const [boxes, dispatch] = useReducer(unboxReducer, [{ id: item.id, phase: 'atCounter' }] as readonly Box[]);
  const opened = boxes[0]?.phase === 'opened';
  useEffect(() => {
    if (!opened) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, timer = setTimeout(done, popDuration(1, reduced));
    return () => clearTimeout(timer);
  }, [opened, done]);
  return <UnboxTray boxes={boxes} items={[item]} ready saveFailed={false} replay={done} loadImage={loadImage}
    slice={(id, progress) => dispatch({ type: 'slice', id, progress })} release={id => dispatch({ type: 'release', id })} openAll={() => dispatch({ type: 'openAll' })} />;
}

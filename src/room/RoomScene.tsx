import { performanceAt, type PerformanceAct, type PerformanceScript } from '../../shared/performance-script';
import type { StudioSet } from '../../shared/studio';
import type { PresenterShot } from './roomModel';
import { TouchCamera } from './touchCamera';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type Ref } from 'react';
import { BatteryMedium, Coffee, RotateCcw } from 'lucide-react';
import type { BaristaAppearance, Character } from '../../shared/domain';
import type { SceneryId } from '../../shared/scenery';
import type { RoomFinishChoice } from '../../shared/room-finishes';
import { baristaArt } from './barista';
import { residentSilhouette } from './silhouette';
import type { Anchor, CameraView, GlowTarget, RoomAnchors, RoomDebugHook, RoomRenderer } from './roomModel';
import { maxRoomAngle, minRoomAngle } from './roomCamera';
import { defaultFurniture, type FurnitureItem } from './furniture';
import { t } from '../i18n';
import { RoomZone } from '../components/RoomZones';
import { graphicsProfile, useGraphicsQuality } from './graphicsQuality';

const clampViewAngle = (angle: number) => Math.max(minRoomAngle, Math.min(maxRoomAngle, angle));

const fallbackAnchors: RoomAnchors = { counter: { x: 4, y: 50, scale: 1, width: 8, height: 14 }, barista: { x: 6, y: 34, scale: 1, width: 6, height: 20 } };
let keptView: CameraView | null = null;
export interface RoomControls { turn(delta: number): void; zoom(factor: number): void; pan?(dx: number, dy: number): void; reset(): void; /** Puts the barista on the presenter spot behind this piece, or back to the counter with null. */ present?(spot: string | null): void; /** The act to play on stage, `elapsed` seconds into it; a long cue keeps the same act running. */ baristaAction?(act: PerformanceAct, elapsed: number): void; capture?(width: number, height: number, background: string): HTMLCanvasElement | null; /** Points a front camera at the presenter (zoom 1–3, `toward` 0 the host … 1 the spot's desk); null gives the room camera back. */ shoot?(shot: PresenterShot | null): void }
export interface RoomDemoProps { demo?: boolean; asleep?: boolean; controls?: Ref<RoomControls>; /** A rehearsal of the stored script, played from `startedAt` (ms, wall clock). */ rehearsal?: { script: PerformanceScript; startedAt: number } | null; onPerformanceEnd?: () => void; /** The spot the barista waits at while the editing desk's camera is on them. */ presenter?: string | null; onReady?: () => void; onFallback?: () => void; debug?: RoomDebugHook; /** Frame the room as a canvas this many CSS pixels tall would; read once, when the room is built. */ frameHeight?: number; /** The studio set standing in the room; `furniture` already leaves out what it covers. */ studioSet?: StudioSet | null }

export function RoomScene({ scenery, counter, barista = 'gpt', baristaAppearance, baristaName, furniture, brightness = 1, finish, hour, paused = false, uiHidden = false, demo = false, asleep = false, controls, rehearsal, onPerformanceEnd, presenter, onReady, onFallback, cameraControls = true, debug, frameHeight, studioSet }: RoomDemoProps & { cameraControls?: boolean; scenery: SceneryId; counter: () => void; barista?: Character; baristaAppearance?: BaristaAppearance; baristaName?: string; furniture?: FurnitureItem[]; brightness?: number; finish?: RoomFinishChoice; hour?: number; paused?: boolean; uiHidden?: boolean }) {
  const initialRoom = useRef({ furniture, brightness, debug, frameHeight, studioSet });
  useLayoutEffect(() => { initialRoom.current = { furniture, brightness, debug, frameHeight, studioSet }; }, [furniture, brightness, debug, frameHeight, studioSet]);
  const host = useRef<HTMLDivElement>(null); const room = useRef<RoomRenderer | null>(null); const worldRef = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<RoomAnchors>(fallbackAnchors); const [ready, setReady] = useState(false); const [fallback, setFallback] = useState(false);
  const [view, setView] = useState(() => ({ angle: demo ? 0 : keptView?.angle ?? 0 }));
  const angle = view.angle;
  const setAngle = (angle: number) => setView({ angle });
  const [turningCamera, setTurningCamera] = useState(false);
  const touchCamera = useRef(new TouchCamera());
  const turning = useRef<{ pointer: number; x: number; angle: number } | null>(null);
  const demoRoom = useRef(demo);
  const graphics = graphicsProfile(useGraphicsQuality().tier);
  const initialGraphics = useRef(graphics);
  useLayoutEffect(() => { initialGraphics.current = graphics; });
  // Antialiasing is fixed when the WebGL context is made, so turning it on or off builds the room again in place.
  const antialias = graphics.antialias; const built = useRef(antialias); const rebuiltView = useRef<CameraView | null>(null);
  useEffect(() => {
    let active = true; const node = host.current; const isDemo = demoRoom.current;
    if (!node) return;
    const rebuilt = built.current !== antialias;
    if (rebuilt) { built.current = antialias; setReady(false); setFallback(false); }
    void import('./roomModel').then(({ buildRoom }) => {
      if (!active) return;
      room.current = buildRoom(node, value => { if (active) setAnchors(value); }, () => { if (active) setReady(true); }, () => { if (active) { room.current?.dispose(); room.current = null; setAnchors(fallbackAnchors); setFallback(true); setReady(true); } }, { ...initialRoom.current, graphics: initialGraphics.current });
      const view = isDemo ? rebuilt && rebuiltView.current : keptView;
      if (view) room.current?.restoreView?.(view);
    }).catch(() => { if (active) { setAnchors(fallbackAnchors); setFallback(true); setReady(true); } });
    return () => { active = false; rebuiltView.current = room.current?.cameraView?.() ?? null; if (!isDemo) keptView = rebuiltView.current ?? keptView; room.current?.dispose(); room.current = null; };
  }, [antialias]);
  useEffect(() => { if (ready && !fallback) onReady?.(); else if (fallback) onFallback?.(); }, [ready, fallback, onReady, onFallback]);
  useEffect(() => { room.current?.sleep?.(asleep); }, [asleep, ready]);
  useEffect(() => { room.current?.graphics?.(graphics); }, [graphics, ready]);
  useEffect(() => { room.current?.brightness(brightness); }, [brightness, ready]);
  useEffect(() => { room.current?.finish?.({ wall: finish?.wall, floor: finish?.floor }); }, [finish?.wall, finish?.floor, ready]);
  useEffect(() => { room.current?.update(scenery); }, [scenery, ready]);
  useEffect(() => { room.current?.view(angle); }, [angle, ready]);
  useEffect(() => { room.current?.barista(barista, baristaAppearance); }, [barista, baristaAppearance, ready]);
  useEffect(() => { room.current?.studioSet?.(studioSet ?? null); }, [studioSet, ready]);
  useEffect(() => { room.current?.furniture(furniture ?? [...defaultFurniture]); }, [furniture, ready]);
  const openCounter = useRef(counter);
  useLayoutEffect(() => { openCounter.current = counter; });
  useEffect(() => { room.current?.open(() => openCounter.current()); }, [ready]);
  useEffect(() => {
    const node = worldRef.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.room-canvas, .physical-board-target, .barista-target')) return;
      event.preventDefault(); const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      room.current?.zoomAt(Math.exp(-Math.max(-60, Math.min(60, pixels)) * .0015), event.clientX, event.clientY);
    };
    node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel);
  }, []);
  const panning = useRef<{ pointer: number; x: number; y: number; moved: boolean } | null>(null);
  const panned = useRef(false);
  const [panningCamera, setPanningCamera] = useState(false);
  const pressCanvas = (event: PointerEvent<HTMLDivElement>) => {
    if (touchCamera.current.active || fallback || !ready || event.pointerType !== 'mouse' || event.button !== 0) return;
    panned.current = false; panning.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  };
  const dragCanvas = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panning.current; if (!pan || pan.pointer !== event.pointerId) return;
    if (!pan.moved && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < 5) return;
    if (!pan.moved) { pan.moved = true; setPanningCamera(true); }
    room.current?.panBy(event.clientX - pan.x, event.clientY - pan.y); pan.x = event.clientX; pan.y = event.clientY;
  };
  const releaseCanvas = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panning.current; if (!pan || pan.pointer !== event.pointerId) return;
    panning.current = null; panned.current = pan.moved; setPanningCamera(false);
  };
  const resetView = () => { setAngle(0); room.current?.resetView(); };
  const turnView = (delta: number) => setAngle(clampViewAngle(angle + delta));
  useImperativeHandle(controls, () => ({ turn: turnView, zoom: factor => room.current?.zoomBy(factor), pan: (dx, dy) => room.current?.panBy(dx, dy), reset: resetView, present: spot => room.current?.present?.(spot), shoot: shot => room.current?.shoot?.(shot), baristaAction: (act, elapsed) => room.current?.perform?.(act, elapsed), capture: (width, height, background) => ready && !fallback ? room.current?.capture?.(width, height, background) ?? null : null }));
  useEffect(() => { room.current?.motion(paused); }, [paused, ready]);
  const [onAir, setOnAir] = useState<{ line: string | null } | null>(null);
  const performanceEnded = useRef(onPerformanceEnd);
  const waitingAt = useRef(presenter);
  useLayoutEffect(() => { performanceEnded.current = onPerformanceEnd; waitingAt.current = presenter; });
  useEffect(() => {
    if (!ready || fallback) return;
    const wait = () => { room.current?.present?.(waitingAt.current ?? null); room.current?.perform?.('idle', 0); };
    // Rooms that never take a presenter (the editing desk's camera) steer the barista themselves.
    if (!rehearsal) { if (presenter !== undefined) wait(); return; }
    let frame = 0, line: string | null | undefined;
    const tick = () => {
      const at = performanceAt(rehearsal.script, (Date.now() - rehearsal.startedAt) / 1000);
      if (at.done) { wait(); setOnAir(null); performanceEnded.current?.(); return; }
      room.current?.present?.(at.spot); room.current?.perform?.(at.act, at.elapsed);
      if (at.line !== line) { line = at.line; setOnAir({ line: at.line }); }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(frame); setOnAir(null); };
  }, [rehearsal, presenter, ready, fallback]);
  const boardPosition = (anchor: Anchor) => ({ left: `${anchor.x}%`, top: `${anchor.y}%`, width: `${anchor.width ?? 18}%`, height: `${anchor.height ?? 18}%` });
  const touchDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !ready || fallback || uiHidden || !(event.target instanceof Element) || event.target.closest('.camera-controls, dialog')) return;
    if (!touchCamera.current.down(event.pointerId, {x:event.clientX,y:event.clientY})) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const touchMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    const active = touchCamera.current.active;
    const motion = touchCamera.current.move(event.pointerId, {x:event.clientX,y:event.clientY});
    if (!active) return;
    event.preventDefault(); event.stopPropagation();
    if (motion) { room.current?.zoomAt(motion.factor,motion.x,motion.y); room.current?.panBy(motion.dx,motion.dy); }
  };
  const touchUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    const used = touchCamera.current.active;
    touchCamera.current.up(event.pointerId,performance.now());
    if (used) { event.preventDefault(); event.stopPropagation(); }
  };
  useEffect(() => {
    const release = (event: globalThis.PointerEvent) => { if (event.pointerType === 'touch') touchCamera.current.up(event.pointerId,performance.now()); };
    window.addEventListener('pointerup',release); window.addEventListener('pointercancel',release);
    return () => { window.removeEventListener('pointerup',release); window.removeEventListener('pointercancel',release); };
  }, []);
  useEffect(() => { if (uiHidden) touchCamera.current.clear(performance.now()); }, [uiHidden]);
  const glow = (target: GlowTarget, reason: 'hover' | 'focus', on: boolean) => room.current?.glowTarget(target, reason, on);
  const focusGlow = (target: GlowTarget, event: FocusEvent<HTMLButtonElement>) => { if (event.currentTarget.matches(':focus-visible')) glow(target, 'focus', true); };
  return <div ref={worldRef} onPointerDownCapture={touchDown} onPointerMoveCapture={touchMove} onPointerUpCapture={touchUp} onPointerCancelCapture={touchUp} onClickCapture={event => { if (touchCamera.current.blocksClick(performance.now())) { event.preventDefault(); event.stopPropagation(); } }} onContextMenu={event => event.preventDefault()} onPointerDown={event => {
      if (!ready || fallback || uiHidden || event.pointerType !== 'mouse' || event.button !== 2 || !(event.target instanceof Element) || !event.target.closest('.room-canvas')) return;
      turning.current = { pointer: event.pointerId, x: event.clientX, angle }; setTurningCamera(true); event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const turn = turning.current; if (!turn || turn.pointer !== event.pointerId) return;
      setAngle(clampViewAngle(turn.angle - (event.clientX - turn.x) * .005));
    }} onPointerUp={event => { if (turning.current?.pointer === event.pointerId) { turning.current = null; setTurningCamera(false); } }} onPointerCancel={() => { turning.current = null; setTurningCamera(false); }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); turnView(event.key === 'ArrowLeft' ? -.1 : .1); }
      if (event.key === 'Home') { event.preventDefault(); resetView(); }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); room.current?.zoomBy(1.2); }
      if (event.key === '-') { event.preventDefault(); room.current?.zoomBy(1 / 1.2); }
    }} className={`house-world ${fallback ? 'world-fallback' : ''} ${turningCamera ? 'world-turning' : ''} ${panningCamera ? 'world-panning' : ''} ${uiHidden ? 'world-ui-hidden' : ''}`}
    data-renderer={fallback ? '2d-fallback' : 'three-webgl'} data-render-ready={ready} aria-label={t('Your shared cafe')} tabIndex={0}
    aria-description={t('Drag to pan, right-drag to rotate and scroll to zoom. On touch screens, use two fingers to zoom and pan.')}>
    <div className="room-canvas" ref={host} data-hour={hour} onPointerDown={pressCanvas} onPointerMove={dragCanvas} onPointerUp={releaseCanvas} onPointerCancel={releaseCanvas} onClick={event => { if (panned.current) { panned.current = false; return; } if (!fallback && ready) room.current?.pokeAt(event.clientX, event.clientY); }} />
    {!fallback && cameraControls && <RoomZone zone="top-left"><div hidden={uiHidden || !ready} className="camera-controls" role="toolbar" aria-label={t('Camera controls')}>
      <button type="button" className="round-control" onClick={resetView} aria-label={t('Reset room view')} title={t('Reset room view')}><RotateCcw size={18} /></button>
    </div></RoomZone>}
    {fallback && <div className="fallback-art"><div className="fallback-barista" style={{ left: `${anchors.barista.x}%`, top: `${anchors.barista.y}%` }}><img className="sprite" src={baristaArt[barista].standee} alt={baristaArt[barista].label} onError={event => { event.currentTarget.src = residentSilhouette; }} /></div></div>}
    <div hidden={uiHidden} className={`world-controls ${ready ? 'ready' : ''}`}>
      <button className="physical-board-target counter-target" style={boardPosition(anchors.counter)} onClick={counter} onPointerEnter={() => glow('counter', 'hover', true)} onPointerLeave={() => glow('counter', 'hover', false)} onFocus={event => focusGlow('counter', event)} onBlur={() => glow('counter', 'focus', false)} aria-label={t('Counter: nothing waiting')} />
      <button className="barista-target" style={{ left: `${anchors.barista.x}%`, top: `${anchors.barista.y}%`, width: `${anchors.barista.width ?? 6}%`, height: `${(anchors.barista.height ?? 20) * .5}%` }} onClick={counter} aria-label={baristaName ?? t('Barista')}><span className="barista-plate"><Coffee size={13} aria-hidden="true" />{baristaName ?? t('Barista')}</span></button>
    </div>
    {onAir && !uiHidden && !presenter && <RoomZone zone="top-left"><div className="studio-on-air" role="status" data-testid="studio-on-air">
      <span className="studio-on-air-badge"><i aria-hidden="true" />{t('Recording')}</span>
      {onAir.line && <p className="studio-caption" data-testid="studio-caption">{onAir.line}</p>}
    </div></RoomZone>}
    {!ready && <div className="room-loading" role="status"><BatteryMedium size={26} /><span>{t("Opening the curtains…")}</span></div>}
  </div>;
}

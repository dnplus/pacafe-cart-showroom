import type { FloorId, FloorSceneView } from '../../shared/floors';
import { isLamp } from './lighting';
import { isSpeaker } from './speakers';
import { mood, pieceNames, pieceName } from './sceneCopy';
import type { RoomAppearance } from './appearance';
import { isBookcase } from '../../shared/library';
import { furnitureTapLine } from '../../shared/furniture-actions';
import { furnitureAccess } from '../../shared/furniture-access';
import { isStudioKey, STUDIO_SET_SPOT, type StudioSet } from '../../shared/studio';
import { hostSeats } from './studioSet';
import type { PresenterShot } from './roomModel';
import { performanceAt, type PerformanceScript } from '../../shared/performance-script';
import type { BaristaAction } from '../../shared/barista-sprites';
import type { FurnitureCoverage } from './assets/coverage';
import { TouchCamera } from './touchCamera';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent, type Ref } from 'react';
import { BatteryMedium, BookOpen, ClipboardList, Coffee, Droplets, Heart, Mail, MessageCircle, MessageCircleOff, Moon, PartyPopper, RotateCcw, Sofa, Sparkles, Sun, X, type LucideIcon } from 'lucide-react';
import type { BaristaAppearance, Character, Snapshot } from '../../shared/domain';
import type { SceneryId } from '../../shared/scenery';
import type { RoomFinishChoice } from '../../shared/room-finishes';
import { agentPool, residentTypeName, Sprite } from '../components/Shared';
import { characterLooks } from './looks';
import { baristaBodies } from './barista';
import type { Anchor, CameraView, Focus, GlowTarget, RoomAnchors, RoomDebugHook, RoomRenderer } from './roomModel';
import { maxRoomAngle, minRoomAngle } from './roomCamera';
import { acceptCheer, acceptCheers, emptyCheers, tickCheers, type Cheer, type CheerWorld, type TalkBubble } from './behavior';
import { jarPuff, jarTreats } from './beanJar';
import { fakeAward, fakeExchange, type CelebrationEvent } from './celebrationFixtures';
import { defaultFurniture, pieces as furniturePieces, type FurnitureItem, type FurnitureKind } from './furniture';
import { wallBoardCopy } from './boardCopy';
import { beanGlyph, bubbleNudge, cheerLayers, counterItems, energyTone, jarGlyph, markSeen, readSeen, residentBadge, treatGlyph, type Bubble, type CheerBubble, type CheerLayer } from './overlay';
import { systemText, t, useLocale } from '../i18n';
import { stairPlacementText, type StairPlacementCode } from './stair-placement';
import { staleChunk } from '../deployedBuild';
import { CopilotScreen } from '../components/CopilotScreen';
import { copilotFeed } from './copilot';
import { RoomZone } from '../components/RoomZones';
import { graphicsProfile, useGraphicsQuality } from './graphicsQuality';


const bubbleLabel: Record<Bubble, 'New task' | 'Typing' | 'Time to rest' | 'No response'> = { task: 'New task', typing: 'Typing', sleep: 'Time to rest', unresponsive: 'No response' };
const sameCue = (a: TalkBubble, b: TalkBubble) => a.agentId === b.agentId && a.variant === b.variant && a.text === b.text;
const emoteIcons: Record<string, LucideIcon> = { gaze: Sun, browse: BookOpen, sip: Coffee, water: Droplets, sit: Sofa, chat: MessageCircle, heart: Heart, sparkle: Sparkles, sleep: Moon, party: PartyPopper };
function CueText({ cue }: { cue: TalkBubble }) {
  if (cue.variant === 'mail') return <Mail size={16} aria-hidden="true" />;
  if (cue.variant === 'emote') { const Icon = emoteIcons[cue.text] ?? Sparkles; return <Icon size={16} aria-hidden="true" />; }
  return <>{cue.text}</>;
}

function nudgeBubbles(overlay: HTMLElement) {
  const boards = [...(overlay.closest('.house-world') ?? document).querySelectorAll<HTMLElement>('.physical-board-target:not(.counter-target)')].map(node => node.getBoundingClientRect());
  const bubbles = [...overlay.querySelectorAll<HTMLElement>('.talk-bubble, .resident-bubble')];
  const shifts = bubbles.map(bubble => {
    const rect = bubble.getBoundingClientRect(); const was = parseFloat(bubble.style.getPropertyValue('--nudge')) || 0;
    return bubbleNudge({ left: rect.left - was, right: rect.right - was, top: rect.top, bottom: rect.bottom }, boards, 28, Math.sign(was), rect.width);
  });
  bubbles.forEach((bubble, k) => bubble.style.setProperty('--nudge', `${shifts[k]}px`));
}

const glyph = (icon: CheerBubble['icon']) => icon === 'beans' ? beanGlyph : treatGlyph[icon];
function CheerLayerView({ layer }: { layer: CheerLayer }) {
  const at = (x: number, y: number, extra: CSSProperties = {}) => ({ '--cx': `${x}px`, '--cy': `${y}px`, ...extra }) as CSSProperties;
  if (layer.layer === 'treat') {
    const p = layer.progress;
    return <span className="cheer-treat" data-cheer="treat" aria-hidden="true" style={at(-90 * (1 - p), -70 * (1 - p) - Math.sin(p * Math.PI) * 30, { scale: String(1 - p * .4) })}>{treatGlyph[layer.icon]}</span>;
  }
  if (layer.layer === 'jar') return <span className="cheer-jar" data-cheer="jar" data-count={layer.count} aria-hidden="true">
    <span className="cheer-jar-pot">{jarGlyph}</span>
    {jarTreats(layer.count, layer.progress).map(item => <span key={item.index} className="cheer-jar-treat" style={at(item.x, item.y, { scale: String(item.scale), opacity: item.opacity })}>{treatGlyph[layer.icon]}</span>)}
    <span className="cheer-jar-count">×{layer.count}</span>
  </span>;
  if (layer.layer === 'pop') {
    const puff = jarPuff(layer.progress);
    return <span className="cheer-jar" data-cheer="pop" aria-hidden="true">
      <span className="cheer-jar-pot" style={{ scale: `${1 + puff.squash * .6} ${1 - puff.squash}` }}>{jarGlyph}</span>
      {puff.beans.map((bean, k) => <span key={k} className="cheer-jar-bean" style={at(bean.x, bean.y, { opacity: bean.opacity })}>{beanGlyph}</span>)}
    </span>;
  }
  return <span className="cheer-bubble" data-cheer="bubble" role="img" aria-label={`${layer.bubble.text} ${glyph(layer.bubble.icon)}`}><span aria-hidden="true">{glyph(layer.bubble.icon)}</span><strong aria-hidden="true">{layer.bubble.text}</strong></span>;
}

const prefersReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clampViewAngle = (angle: number) => Math.max(minRoomAngle, Math.min(maxRoomAngle, angle));
declare global { interface Window { paCafeCheer?: (agent: string, kind?: CelebrationEvent['kind']) => void } }

function BubbleIcon({ kind }: { kind: Bubble }) {
  if (kind === 'typing') return <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>;
  const Icon = kind === 'sleep' ? Moon : kind === 'unresponsive' ? MessageCircleOff : ClipboardList;
  return <Icon size={16} aria-hidden="true" />;
}

const fallbackAnchors: RoomAnchors = { residents: [{ x: 28, y: 45, scale: 1 }, { x: 52, y: 55, scale: 1 }, { x: 76, y: 44, scale: 1 }], desks: [{ x: 26, y: 69, scale: 1 }, { x: 52, y: 78, scale: 1 }, { x: 76, y: 67, scale: 1 }], energy: { x: 37, y: 22, scale: 1 }, notice: { x: 52, y: 24, scale: 1 }, counter: { x: 4, y: 50, scale: 1, width: 8, height: 14 }, barista: { x: 6, y: 34, scale: 1, width: 6, height: 20 } };
let keptView: CameraView | null = null;
export interface RoomControls { turn(delta: number): void; zoom(factor: number): void; pan?(dx: number, dy: number): void; reset(): void; clearPiece(): void; /** Puts the barista on the presenter spot behind this piece, or back to roaming with null. */ present?(spot: string | null): void; /** The act to play on stage, `elapsed` seconds into it; a long cue keeps the same act running. */ baristaAction?(act: BaristaAction, elapsed: number): void; capture?(width: number, height: number, background: string): HTMLCanvasElement | null; /** Points a front camera at the presenter (zoom 1–3, `toward` 0 the host … 1 the spot's desk); null gives the room camera back. */ shoot?(shot: PresenterShot | null): void }
/** Which parts of a resident's nametag a visitor's room shows; the owner's own room shows the dot and the bar. */
export interface NametagParts { dot: boolean; bar: boolean; type: boolean }
export interface RoomDemoProps { nametag?: NametagParts; /** A visitor's room whose wall board holds nothing to open. */ boardLocked?: boolean; activeFloor?: FloorId; stairways?: FurnitureItem[]; onStair?: (id: string) => void; floorView?: FloorSceneView; demo?: boolean; asleep?: boolean; controls?: Ref<RoomControls>; onGameTable?: (id: string) => void; /** Set only upstairs, where a laptop or tablet stand opens the self-media room. */ onStudio?: (id: string) => void; /** A rehearsal of the stored script, played from `startedAt` (ms, wall clock). */ rehearsal?: { script: PerformanceScript; startedAt: number } | null; onPerformanceEnd?: () => void; /** The spot the barista waits at while the editing desk's camera is on them; that camera then shows the recording badge instead of the room. */ presenter?: string | null; onBookcase?: () => void; onPiece?: (kind: FurnitureKind) => void; onReady?: () => void; onFallback?: () => void; debug?: RoomDebugHook; /** Frame the room as a canvas this many CSS pixels tall would; read once, when the room is built. */ frameHeight?: number; /** The studio set up on this floor; `furniture` already leaves out what it covers. */ studioSet?: StudioSet | null; /** Residents working at a laptop's self-media project. */ editors?: readonly { agentId: string; furnitureId: string }[]; /** The barista's own room with a set up: tapping a chair or the set offers to host from there. */ hostSpot?: { at: string; choose: (spot: string) => void } }

export function RoomScene({ activeFloor = 0, stairways, onStair, floorView, snapshot, scenery, inspect, energy, counter, barista = 'gpt', baristaAppearance, baristaWaiting = false, baristaName, editBarista, furniture, placementFurniture, coveredFurniture, appearance = 'original', brightness = 1, finish, hour, onFurnitureStatus, arranging = false, selected = null, select, move, focus = null, paused = false, subdued, uiHidden = false, onOpen, celebrations, cameraResetVersion = 0, panelOpen = false, demo = false, asleep = false, nametag, boardLocked = false, controls, onGameTable, onStudio, rehearsal, onPerformanceEnd, presenter, onBookcase, onPiece, onReady, onFallback, speakerIds, onSpeaker, cameraControls = true, debug, frameHeight, studioSet, editors, hostSpot }: RoomDemoProps & { cameraControls?: boolean; speakerIds?: ReadonlySet<string>; onSpeaker?: (id: string) => void; snapshot: Snapshot | null; scenery: SceneryId; inspect: (id: string) => void; energy: () => void; counter: () => void; barista?: Character; baristaAppearance?: BaristaAppearance; baristaWaiting?: boolean; baristaName?: string; editBarista?: () => void; furniture?: FurnitureItem[]; placementFurniture?: readonly FurnitureItem[]; coveredFurniture?: readonly string[]; appearance?: RoomAppearance; brightness?: number; finish?: RoomFinishChoice; hour?: number; onFurnitureStatus?: (coverage: FurnitureCoverage) => void; arranging?: boolean; selected?: string | null; select?: (id: string | null) => void; move?: (id: string, x: number, z: number) => boolean; focus?: Focus | null; paused?: boolean; subdued?: boolean; uiHidden?: boolean;   onOpen?: (panel: 'energy' | 'counter' | 'notice') => void; celebrations?: readonly CelebrationEvent[]; cameraResetVersion?: number; panelOpen?: boolean }) {
  const locale = useLocale();
  const initialRoom = useRef({ furniture, placementFurniture, coveredFurniture, appearance, brightness, floorView, activeFloor, stairways, debug, frameHeight, studioSet });
  useLayoutEffect(() => { initialRoom.current = { furniture, placementFurniture, coveredFurniture, appearance, brightness, floorView, activeFloor, stairways, debug, frameHeight, studioSet }; }, [furniture, placementFurniture, coveredFurniture, appearance, brightness, floorView, activeFloor, stairways, debug, frameHeight, studioSet]);
  const furnitureStatusListener = useRef(onFurnitureStatus);
  useLayoutEffect(() => { furnitureStatusListener.current = onFurnitureStatus; });
  const [furnitureStatus, setFurnitureStatus] = useState<FurnitureCoverage | null>(null);
  const host = useRef<HTMLDivElement>(null); const room = useRef<RoomRenderer | null>(null); const overlayRef = useRef<HTMLDivElement>(null); const worldRef = useRef<HTMLDivElement>(null);
  const cues = useRef<TalkBubble[]>([]);
  const [anchors, setAnchors] = useState<RoomAnchors>(fallbackAnchors); const [ready, setReady] = useState(false); const [fallback, setFallback] = useState(false); const [, setSeenTick] = useState(0);
  const [talk, setTalk] = useState<TalkBubble[]>([]); const [leaving, setLeaving] = useState<TalkBubble[]>([]);
  const [onCounter, setOnCounter] = useState(0);
  const agents = snapshot?.agents.filter(a => a.presence !== 'left') ?? [];
  const copilot = (agentId: string) => { const feed = snapshot && copilotFeed(snapshot, agentId); return feed?.lines.length ? <div className="copilot-at"><CopilotScreen feed={feed} variant="laptop" /></div> : null; };
  const press = useRef<{ id: string; pointer: number; x: number; y: number; dragging: boolean } | null>(null);
  const suppressClick = useRef<{ id: string; timer: number } | null>(null); const [dragging, setDragging] = useState(false);
  const [objectInfo, setObjectInfo] = useState<FurnitureKind | null>(null), [tapLine, setTapLine] = useState<ReturnType<typeof furnitureTapLine>>();
  const [placement, setPlacement] = useState<boolean | null>(null);
  const [placementReason, setPlacementReason] = useState<StairPlacementCode | undefined>();
  const [placingSurface, setPlacingSurface] = useState(false);
  const [view, setView] = useState(() => ({ angle: demo ? 0 : keptView?.angle ?? 0, reset: cameraResetVersion }));
  const angle = view.reset === cameraResetVersion ? view.angle : 0;
  const setAngle = (angle: number) => setView({ angle, reset: cameraResetVersion });
  const [turningCamera, setTurningCamera] = useState(false);
  const touchCamera = useRef(new TouchCamera());
  const turning = useRef<{ pointer: number; x: number; angle: number } | null>(null);
  const pressResident = (id: string) => (event: PointerEvent<HTMLButtonElement>) => {
    if (touchCamera.current.active || fallback || !ready || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.stopPropagation();
    if (press.current) return;
    press.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  };
  const moveResident = useCallback((event: globalThis.PointerEvent) => {
    const held = press.current; if (!held || held.pointer !== event.pointerId) return;
    if (!held.dragging) {
      const moved = Math.hypot(event.clientX - held.x, event.clientY - held.y);
      if (moved < 8) return;
      held.dragging = true; setDragging(true); room.current?.grab(held.id);
    }
    if (event.cancelable) event.preventDefault();
    room.current?.drag(held.id, event.clientX, event.clientY);
  }, []);
  const releaseResident = useCallback((event: globalThis.PointerEvent) => {
    const held = press.current; if (!held || held.pointer !== event.pointerId) return;
    press.current = null;
    if (held.dragging) {
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') room.current?.cancel(held.id);
      else {
        room.current?.drop(held.id);
        if (suppressClick.current) window.clearTimeout(suppressClick.current.timer);
        const suppression = { id: held.id, timer: 0 };
        suppression.timer = window.setTimeout(() => { if (suppressClick.current === suppression) suppressClick.current = null; }, 0);
        suppressClick.current = suppression;
      }
      setDragging(false);
    }
  }, []);
  useEffect(() => {
    window.addEventListener('pointermove', moveResident);
    window.addEventListener('pointerup', releaseResident);
    window.addEventListener('pointercancel', releaseResident);
    window.addEventListener('lostpointercapture', releaseResident);
    return () => {
      window.removeEventListener('pointermove', moveResident);
      window.removeEventListener('pointerup', releaseResident);
      window.removeEventListener('pointercancel', releaseResident);
      window.removeEventListener('lostpointercapture', releaseResident);
      const held = press.current; if (held?.dragging) room.current?.cancel(held.id);
      press.current = null; setDragging(false);
      if (suppressClick.current) window.clearTimeout(suppressClick.current.timer);
      suppressClick.current = null;
    };
  }, [moveResident, releaseResident]);
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
    void import('./roomModel').catch(staleChunk).then(({ buildRoom }) => {
      if (!active) return;
      room.current = buildRoom(node, value => { if (active) setAnchors(value); }, () => { if (active) setReady(true); }, () => { if (active) { room.current?.dispose(); room.current = null; setAnchors(fallbackAnchors); setFallback(true); setReady(true); } }, { ...initialRoom.current, persistLights: !isDemo, graphics: initialGraphics.current, status: coverage => { if (active) { setFurnitureStatus(coverage); furnitureStatusListener.current?.(coverage); } } });
      const view = isDemo ? rebuilt && rebuiltView.current : keptView;
      if (view) room.current?.restoreView?.(view);
    }).catch(() => { if (active) { setAnchors(fallbackAnchors); setFallback(true); setReady(true); } });
    return () => { active = false; rebuiltView.current = room.current?.cameraView?.() ?? null; if (!isDemo) keptView = rebuiltView.current ?? keptView; room.current?.dispose(); room.current = null; };
  }, [antialias]);
  useEffect(() => { if (ready && !fallback) onReady?.(); else if (fallback) onFallback?.(); }, [ready, fallback, onReady, onFallback]);
  useEffect(() => { room.current?.sleep?.(asleep); }, [asleep, ready]);
  useEffect(() => { room.current?.graphics?.(graphics); }, [graphics, ready]);
  useEffect(() => { room.current?.appearance(appearance); }, [appearance, ready]);
  useEffect(() => { room.current?.brightness(brightness); }, [brightness, ready]);
  useEffect(() => { room.current?.finish?.({ wall: finish?.wall, floor: finish?.floor }); }, [finish?.wall, finish?.floor, ready]);
  useEffect(() => { room.current?.stairs?.(stairways ?? [], activeFloor); }, [stairways, activeFloor, ready]);
  useEffect(() => { room.current?.floorView?.(floorView); }, [floorView, ready]);
  useEffect(() => { room.current?.update(snapshot, scenery, locale); }, [snapshot, scenery, ready, locale]);
  useEffect(() => { room.current?.view(angle); }, [angle, ready]);
  const appliedReset = useRef(cameraResetVersion);
  useEffect(() => {
    if (!ready || appliedReset.current === cameraResetVersion) return;
    appliedReset.current = cameraResetVersion; room.current?.resetView();
  }, [cameraResetVersion, ready]);
  useEffect(() => { room.current?.barista(barista, baristaAppearance); }, [barista, baristaAppearance, ready]);
  useEffect(() => { room.current?.studioSet?.(studioSet ?? null); }, [studioSet, ready]);
  useEffect(() => { room.current?.editors?.(editors ?? []); }, [editors, ready]);
  const [hostPick, setHostPick] = useState<string | null>(null);
  useEffect(() => { room.current?.furniture(furniture ?? [...defaultFurniture], coveredFurniture); }, [furniture, coveredFurniture, ready]);
  useEffect(() => { room.current?.placementFurniture?.(placementFurniture); }, [placementFurniture, ready]);
  useEffect(() => { room.current?.select(arranging ? selected : null); room.current?.arrange(arranging); }, [arranging, selected, ready]);
  useEffect(() => { room.current?.board(focus?.kind === 'board' ? focus.id : null); }, [focus, ready]);
  const openPanel = useRef<(panel: 'energy' | 'counter' | 'notice') => void>(() => {});
  const opened = useRef(false);
  useEffect(() => { room.current?.open(panel => { opened.current = true; openPanel.current(panel); }); }, [ready]);
  useEffect(() => {
    const node = worldRef.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.room-canvas, .physical-board-target, .barista-target, .resident-hit')) return;
      event.preventDefault(); const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
      room.current?.zoomAt(Math.exp(-Math.max(-60, Math.min(60, pixels)) * .0015), event.clientX, event.clientY);
    };
    node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel);
  }, []);
  const moving = useRef<{ id: string; pointer: number; x: number; y: number; at: { x: number; z: number; ok: boolean; reason?: StairPlacementCode } | null } | null>(null);
  const panning = useRef<{ pointer: number; x: number; y: number; moved: boolean } | null>(null);
  const panned = useRef(false);
  const [panningCamera, setPanningCamera] = useState(false);
  const pressPiece = (event: PointerEvent<HTMLDivElement>) => {
    if (!arranging && !touchCamera.current.active && !fallback && ready && event.pointerType === 'mouse' && event.button === 0) {
      panned.current = false; panning.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
      return;
    }
    if (touchCamera.current.active || !arranging || fallback || !ready || event.button !== 0) return;
    setPlacement(null);
    const id = room.current?.pickPiece(event.clientX, event.clientY) ?? null; select?.(id); if (!id) return;
    room.current?.dragPiece(id, event.clientX, event.clientY);
    const kind = furniture?.find(item => item.id === id)?.kind; setPlacingSurface(kind !== undefined && furniturePieces[kind].mount === 'surface');
    moving.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, at: null }; event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragPiece = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panning.current;
    if (pan && pan.pointer === event.pointerId) {
      if (!pan.moved && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < 5) return;
      if (!pan.moved) { pan.moved = true; setPanningCamera(true); }
      room.current?.panBy(event.clientX - pan.x, event.clientY - pan.y); pan.x = event.clientX; pan.y = event.clientY;
      return;
    }
    const held = moving.current; if (!held || held.pointer !== event.pointerId) return;
    if (!held.at && Math.hypot(event.clientX - held.x, event.clientY - held.y) < 5) return;
    held.at = room.current?.dragPiece(held.id, event.clientX, event.clientY) ?? held.at;
    setPlacement(held.at?.ok ?? null); setPlacementReason(held.at?.reason);
  };
  const dropPiece = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panning.current;
    if (pan && pan.pointer === event.pointerId) { panning.current = null; panned.current = pan.moved; setPanningCamera(false); return; }
    const held = moving.current; if (!held || held.pointer !== event.pointerId) return;
    moving.current = null; room.current?.endDrag();
    if (event.type !== 'pointercancel' && held.at) move?.(held.id, held.at.x, held.at.z);
    setPlacement(null);
  };
  useEffect(() => { room.current?.counterViewing(focus?.kind === 'counter'); }, [focus?.kind, ready]);
  const resetView = () => { setAngle(0); room.current?.resetView(); };
  const turnView = (delta: number) => setAngle(clampViewAngle(angle + delta));
  useImperativeHandle(controls, () => ({ turn: turnView, zoom: factor => room.current?.zoomBy(factor), pan: (dx, dy) => room.current?.panBy(dx, dy), reset: resetView, clearPiece: () => room.current?.select(null), present: spot => room.current?.present?.(spot), shoot: shot => room.current?.shoot?.(shot), baristaAction: (act, elapsed) => room.current?.perform?.(act, elapsed), capture: (width, height, background) => ready && !fallback ? room.current?.capture?.(width, height, background) ?? null : null }));
  useEffect(() => { room.current?.motion(paused); }, [paused, ready]);
  const [onAir, setOnAir] = useState<{ line: string | null } | null>(null);
  const performanceEnded = useRef(onPerformanceEnd);
  const waitingAt = useRef(presenter);
  useLayoutEffect(() => { performanceEnded.current = onPerformanceEnd; waitingAt.current = presenter; });
  useEffect(() => {
    if (!ready || fallback) return;
    const wait = () => { room.current?.present?.(waitingAt.current ?? null); room.current?.perform?.('idle', 0); };
    // Rooms that never take a presenter (the A-roll stage, the desk's camera) steer the barista themselves.
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
  const cheerWorld = useRef<CheerWorld>(emptyCheers());
  const [cheer, setCheer] = useState<{ now: number; active: Record<string, Cheer> }>({ now: 0, active: {} });
  const [cheerWake, setCheerWake] = useState(0);
  const wakeCheers = useCallback((next: CheerWorld) => {
    const queued = next.pending !== cheerWorld.current.pending;
    cheerWorld.current = next; if (queued) setCheerWake(n => n + 1);
  }, []);
  const queueCheer = useCallback((event: CelebrationEvent) => wakeCheers(acceptCheer(cheerWorld.current, event)), [wakeCheers]);
  useEffect(() => { wakeCheers(acceptCheers(cheerWorld.current, celebrations ?? [])); }, [celebrations, wakeCheers]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = performance.now(); const world = tickCheers(cheerWorld.current, now); cheerWorld.current = world;
      room.current?.cheers(world.active); setCheer({ now, active: world.active });
      if (Object.keys(world.active).length || Object.keys(world.pending).length) frame = requestAnimationFrame(tick);
    };
    if (cheerWake) tick();
    return () => cancelAnimationFrame(frame);
  }, [cheerWake]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let n = 0;
    window.paCafeCheer = (agent, kind = 'award') => { n += 1; queueCheer(kind === 'award' ? fakeAward(agent, 'cookie', `dev:${Date.now()}:${n}`) : fakeExchange(agent, 'cookie', 3, `dev:${Date.now()}:${n}`)); };
    return () => { delete window.paCafeCheer; };
  }, [queueCheer]);
  const cheerCalm = paused || prefersReduced() || graphics.calmDecor;
  const cheering = cheerLayers(cheer.active, cheer.now, cheerCalm);
  useEffect(() => {
    const renderer = room.current;
    if (!renderer) return;
    renderer.follow(points => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      for (const point of points) {
        const node = overlay.querySelector<HTMLElement>(`[data-resident="${CSS.escape(point.id)}"]`);
        if (!node) continue;
        node.style.setProperty('--hx', `${point.headX}%`);
        node.style.setProperty('--hy', `${point.headY}%`);
        node.style.setProperty('--fx', `${point.footX}%`);
        node.style.setProperty('--fy', `${point.footY}%`);
        node.style.setProperty('--w', `${point.width}%`);
        node.style.zIndex = String(Math.round(point.footY));
        if (point.mode) node.dataset.mode = point.mode;
      }
      nudgeBubbles(overlay);
    });
    renderer.counter(setOnCounter);
    renderer.talk(next => {
      const prev = cues.current;
      const gone = prev.filter(item => !next.some(cue => sameCue(item, cue)));
      cues.current = next;
      setTalk(next);
      if (!gone.length) return;
      setLeaving(value => [...value, ...gone]);
      window.setTimeout(() => setLeaving(value => value.filter(item => !gone.some(cue => sameCue(item, cue)))), 140);
    });
  }, [ready]);
  useLayoutEffect(() => { if (overlayRef.current) nudgeBubbles(overlayRef.current); }, [talk]);
  const position = (anchor: { x: number; y: number }) => ({ left: `${anchor.x}%`, top: `${anchor.y}%` });
  const residentAnchor = (index: number) => anchors.residents[index] ?? { x: 15 + (index % 5) * 17, y: 48 + Math.floor(index / 5) * 8, scale: 1 };
  const boardPosition = (anchor: Anchor) => ({ ...position(anchor), width: `${anchor.width ?? 18}%`, height: `${anchor.height ?? 18}%` });
  const boards = wallBoardCopy(snapshot, locale);
  const waiting = snapshot ? counterItems(snapshot, id => demo ? 0 : readSeen(snapshot.house, id)) : [];
  const touchDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !ready || fallback || uiHidden || panelOpen || !(event.target instanceof Element) || event.target.closest('.camera-controls, .room-status-board, dialog')) return;
    if (!touchCamera.current.down(event.pointerId, {x:event.clientX,y:event.clientY})) return;
    const held = press.current; if (held) room.current?.cancel(held.id);
    press.current = null; setDragging(false);
    if (moving.current) room.current?.endDrag();
    moving.current = null; setPlacement(null);
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
  useEffect(() => { if (panelOpen || uiHidden) touchCamera.current.clear(performance.now()); }, [panelOpen,uiHidden]);
  const glow = (target: GlowTarget, reason: 'hover' | 'focus', on: boolean) => room.current?.glowTarget(target, reason, on);
  const focusGlow = (target: GlowTarget, event: FocusEvent<HTMLButtonElement>) => { if (event.currentTarget.matches(':focus-visible')) glow(target, 'focus', true); };
  const openCounter = () => { room.current?.baristaAction?.('greet'); if (snapshot && !demo) for (const id of new Set(waiting.map(item => item.agentId))) markSeen(snapshot.house, id, snapshot.now); setSeenTick(tick => tick + 1); counter(); };
  useEffect(() => { openPanel.current = panel => { if (panel === 'counter') openCounter(); else if (panel === 'energy') energy(); else onOpen?.(panel); }; });
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
    }} className={`house-world ${subdued ? 'world-subdued' : ''} ${fallback ? 'world-fallback' : ''} ${dragging ? 'world-dragging' : ''} ${turningCamera ? 'world-turning' : ''} ${panningCamera ? 'world-panning' : ''} ${arranging ? 'world-arranging' : ''} ${uiHidden ? 'world-ui-hidden' : ''}`}
    data-renderer={fallback ? '2d-fallback' : 'three-webgl'} data-render-ready={ready} aria-label={t('Your shared cafe')} tabIndex={0}
    aria-description={t('Drag to pan, right-drag to rotate and scroll to zoom. On touch screens, use two fingers to zoom and pan.')}>
    <div className="room-canvas" ref={host} data-hour={hour} data-starter-anchor="room" onPointerDown={pressPiece} onPointerMove={dragPiece} onPointerUp={dropPiece} onPointerCancel={dropPiece} onClick={event => { if (panned.current) { panned.current = false; return; } if (!fallback && ready && !arranging) { const stair = room.current?.pickStair?.(event.clientX,event.clientY); if (stair && onStair) { onStair(stair); return; } opened.current = false; if (hostSpot) { const seat = room.current?.pickSet?.(event.clientX, event.clientY) ? STUDIO_SET_SPOT : room.current?.pickPiece(event.clientX, event.clientY); if (seat && (seat === STUDIO_SET_SPOT || hostSeats(furniture ?? []).includes(seat))) { setObjectInfo(null); setHostPick(seat); return; } setHostPick(null); } const kind = room.current?.pokeAt(event.clientX, event.clientY); if (opened.current) { setObjectInfo(null); return; } if (kind && isBookcase(kind) && onBookcase) { setObjectInfo(null); onBookcase(); return; } if (kind && onStudio && isStudioKey({ kind })) { const pickedId = room.current?.pickPiece(event.clientX,event.clientY); if (pickedId) { setObjectInfo(null); onStudio(pickedId); return; } } if (kind === 'collect_game_table' && onGameTable) { const pickedId = room.current?.pickPiece(event.clientX,event.clientY); if (pickedId) { setObjectInfo(null); onGameTable(pickedId); return; } } if (kind && isSpeaker(kind)) { const id = room.current?.pickPiece(event.clientX, event.clientY); if (id && speakerIds?.has(id)) { setObjectInfo(null); onSpeaker?.(id); return; } } const piece = kind && kind in pieceNames ? kind as FurnitureKind : null; if (onPiece) { if (piece && !isLamp(piece)) onPiece(piece); } else { const line = piece ? furnitureTapLine(piece) : undefined; setTapLine(line && furnitureAccess({ kind: 'piece-tap', present: Boolean(room.current?.pickPiece(event.clientX, event.clientY)) }).allowed ? line : undefined); setObjectInfo(piece && !isLamp(piece) ? piece : null); } } }} />
    {!fallback && ready && !uiHidden && !panelOpen && !arranging && onStair && anchors.stairs?.map(anchor => <button key={anchor.id} className="stair-scene-target" data-stair-id={anchor.id} style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }} onClick={() => onStair(anchor.id)} aria-label={t(activeFloor === 0 ? 'Go upstairs' : 'Go downstairs')}>{activeFloor === 0 ? '2F ↑' : '1F ↓'}</button>)}
    {!fallback && ready && !uiHidden && !panelOpen && !arranging && onSpeaker && anchors.speakers?.filter(anchor => speakerIds?.has(anchor.id)).map(anchor => <button key={anchor.id} type="button" className="speaker-keyboard-target" style={boardPosition(anchor)} onClick={() => onSpeaker(anchor.id)} aria-label={t('Open speaker music controls')} aria-haspopup="dialog" />)}
    {!fallback && ready && !uiHidden && !panelOpen && !arranging && anchors.lamps?.map((anchor, _i, lamps) => { const same = lamps.filter(other => other.kind === anchor.kind); return <button key={anchor.id} type="button" className="lamp-keyboard-target" data-lamp-id={anchor.id} style={boardPosition(anchor)} onClick={() => room.current?.toggleLamp(anchor.id)} aria-label={same.length > 1 ? `${pieceName(anchor.kind)} ${same.indexOf(anchor) + 1}` : pieceName(anchor.kind)} aria-pressed={anchor.on} />; })}
    {furnitureStatus && furnitureStatus.ready < furnitureStatus.total && <RoomZone zone="bottom-left"><div className="furniture-load-status" role="status" data-ready={furnitureStatus.ready} data-loading={furnitureStatus.loading} data-fallback={furnitureStatus.fallback} data-missing={furnitureStatus.missing}>
      <span>{furnitureStatus.ready}/{furnitureStatus.total} {t('Furniture ready')}</span>
      {furnitureStatus.loading > 0 && <span>{t('Loading furniture')} {furnitureStatus.loading}</span>}
      {furnitureStatus.missing > 0 && <span>{t('Furniture not available yet')} {furnitureStatus.missing}</span>}
      {furnitureStatus.fallback > 0 && <><span>{t('Furniture failed to load')} {furnitureStatus.fallback}</span><button onClick={() => room.current?.retryFurniture()}>{t('Retry furniture')}</button></>}
    </div></RoomZone>}
    {!fallback && cameraControls && <RoomZone zone="top-left"><div hidden={uiHidden || !ready || panelOpen || arranging} className="camera-controls" role="toolbar" aria-label={t('Camera controls')}>
      <button type="button" className="round-control" onClick={resetView} aria-label={t('Reset room view')} title={t('Reset room view')}><RotateCcw size={18} /></button>
    </div></RoomZone>}
    {fallback && <div className="fallback-art"><img src="/art/studio.png" alt={t("Shared office, shown in 2D because 3D is unavailable")} />
      <div className="fallback-barista" style={{ left: `${anchors.barista.x}%`, top: `${anchors.barista.y}%` }}><Sprite character={barista} art="barista" portrait={baristaBodies(barista, baristaAppearance).filter(body => body.kind === 'standee').map(body => ({ kind: 'standee', src: body.src }))} /></div>
      {agents.map((agent, i) => <div className="fallback-resident" key={agent.id} style={{ left: `${residentAnchor(i).x}%` }}><Sprite character={agent.character} portrait={characterLooks(agent)} /></div>)}</div>}
    <div hidden={uiHidden || activeFloor === 1} className={`world-controls ${ready ? 'ready' : ''}`}>
      <button className="physical-board-target counter-target" data-starter-anchor="counter" data-selected={focus?.kind === 'counter'} style={boardPosition(anchors.counter)} onClick={openCounter} onPointerEnter={() => glow('counter', 'hover', true)} onPointerLeave={() => glow('counter', 'hover', false)} onFocus={event => focusGlow('counter', event)} onBlur={() => glow('counter', 'focus', false)} aria-label={onCounter ? t('Counter: {count} waiting for you', { count: onCounter }) : t('Counter: nothing waiting')}>{onCounter > 0 && <span className="counter-badge" aria-hidden="true">{onCounter}</span>}</button>
      <button className="barista-target" style={{ left: `${anchors.barista.x}%`, top: `${anchors.barista.y}%`, width: `${anchors.barista.width ?? 6}%`, height: `${(anchors.barista.height ?? 20) * .5}%` }} onClick={editBarista} aria-label={baristaWaiting ? t('A new barista look is waiting for you') : t('You are the barista. Change your look')}><span className="barista-plate"><Coffee size={13} aria-hidden="true" />{baristaName ?? t('Barista')}{baristaWaiting && <i className="barista-waiting" aria-hidden="true" />}</span></button>
      <button className="physical-board-target notice-board" data-starter-anchor="notices" style={boardPosition(anchors.notice)} onPointerEnter={() => glow('notice', 'hover', true)} onPointerLeave={() => glow('notice', 'hover', false)} onFocus={event => focusGlow('notice', event)} onBlur={() => glow('notice', 'focus', false)} onClick={() => onOpen?.('notice')} aria-label={t('House notice')}><span className={fallback ? '' : 'sr-only'}>{t('House notice')}</span></button>
      <button className="physical-board-target performance-board" data-starter-anchor="work-board" disabled={boardLocked} style={boardLocked ? { ...boardPosition(anchors.energy), pointerEvents: 'none' } : boardPosition(anchors.energy)} onPointerEnter={() => glow('energy', 'hover', true)} onPointerLeave={() => glow('energy', 'hover', false)} onFocus={event => focusGlow('energy', event)} onBlur={() => glow('energy', 'focus', false)} onClick={energy} aria-haspopup={boardLocked ? undefined : 'dialog'} aria-label={t('Performance and energy board: {summary}', { summary: [...boards.indicators, ...boards.performance.slice(1), ...boards.residents.map(resident => `${resident.name} ${t('Quota')}: ${resident.energy}`)].join(', ') })}><span className={fallback ? '' : 'sr-only'}>{[...boards.indicators, ...boards.performance].join(' · ')}</span></button>
    </div>
    <div hidden={uiHidden} className={`room-overlay ${ready ? 'ready' : ''}`} ref={overlayRef}>
      {agents.map((agent, index) => {
        const badge = residentBadge(snapshot!, agent);
        const placed = fallback ? { '--hx': `${residentAnchor(index).x}%`, '--hy': `${residentAnchor(index).y - 18}%`, '--fx': `${residentAnchor(index).x}%`, '--fy': `${residentAnchor(index).y}%`, '--w': '14%' } as CSSProperties : undefined;
        const own = cheer.active[agent.id];
        const speaking = talk.some(cue => cue.agentId === agent.id) || leaving.some(cue => cue.agentId === agent.id);
        return <div key={agent.id} className="resident-anchor" data-resident={agent.id} data-selected={focus?.kind === 'resident' && focus.id === agent.id} data-cheering={own ? own.event.kind : undefined} style={placed}>
          <button type="button" className="resident-hit" onPointerDown={pressResident(agent.id)} onContextMenu={event => event.preventDefault()} onClick={() => { if (suppressClick.current?.id === agent.id) { window.clearTimeout(suppressClick.current.timer); suppressClick.current = null; return; } room.current?.poke(agent.id); if (!demo) markSeen(snapshot!.house, agent.id, snapshot!.now); setSeenTick(tick => tick + 1); const desk = onStudio && editors?.find(entry => entry.agentId === agent.id); if (desk) onStudio(desk.furnitureId); else inspect(agent.id); }} aria-label={t('Visit {name}, {mood}, battery {battery}', { name: agent.name, mood: mood(agent), battery: agentPool(snapshot!, agent) ? t('details available') : t('Unknown') })} />
          {badge.bubble && !speaking && <span className={`resident-bubble bubble-${badge.bubble}`} role="img" aria-label={t(bubbleLabel[badge.bubble])}><BubbleIcon kind={badge.bubble} /></span>}
          {talk.filter(cue => cue.agentId === agent.id).map(cue => <span key={`${cue.variant}:${cue.text}`} className={`talk-bubble talk-${cue.variant}`} data-cue={cue.text} aria-hidden={cue.variant === 'emote' || undefined} role={cue.variant === 'speech' || cue.variant === 'emote' ? undefined : 'img'} aria-label={cue.variant === 'mail' ? t('Mail waiting for {name}', { name: agent.name }) : cue.variant === 'speech' || cue.variant === 'emote' ? undefined : cue.text}><span className="talk-text"><CueText cue={cue} /></span></span>)}
          {leaving.filter(cue => cue.agentId === agent.id).map(cue => <span key={`out:${cue.variant}:${cue.text}`} className={`talk-bubble talk-${cue.variant} out`} aria-hidden="true"><span className="talk-text"><CueText cue={cue} /></span></span>)}
          {cheering.filter(layer => layer.agentId === agent.id).map(layer => <CheerLayerView key={layer.layer} layer={layer} />)}
          {copilot(agent.id)}
          <span className={nametag ? 'resident-plate visitor' : 'resident-plate'}>{nametag?.dot !== false && <i className={`presence-dot ${agent.presence ?? 'present'}`} title={mood(agent)} />}<strong>{badge.name}</strong>{nametag?.type && agent.residentType && <small className="resident-type-label" data-type={agent.residentType}>{residentTypeName(agent.residentType)}</small>}{badge.energy !== null && nametag?.bar !== false && <span className="ebar"><i className={energyTone(badge.energy)} style={{ width: `${badge.energy}%` }} /></span>}</span>
        </div>;
      })}
    </div>
    {!uiHidden && !arranging && !focus && objectInfo && <RoomZone zone="bottom-left"><aside className="room-object-info" aria-label={t('Selected furniture')}>
      <strong>{pieceName(objectInfo)}</strong>{tapLine ? <span className="room-object-line" role="status">{t(tapLine)}</span> : <span>{t('Use Decorate to move or change furniture.')}</span>}
      <button className="quiet-icon" aria-label={t('Close panel')} onClick={() => { setObjectInfo(null); room.current?.select(null); }}><X size={18} /></button>
    </aside></RoomZone>}
    {!uiHidden && !arranging && !focus && hostSpot && hostPick && (hostPick === STUDIO_SET_SPOT || hostSeats(furniture ?? []).includes(hostPick)) && <RoomZone zone="bottom-left"><aside className="room-object-info studio-host-pick" aria-label={t('Host spot')} data-testid="studio-host-pick">
      <strong>{hostPick === STUDIO_SET_SPOT ? t('The studio set') : pieceName((furniture ?? []).find(item => item.id === hostPick)?.kind ?? 'chair')}</strong>
      {hostSpot.at === hostPick ? <span className="room-object-line" role="status">{t('The barista hosts from here.')}</span>
        : <button type="button" className="main-action" data-testid="studio-host-here" onClick={() => { hostSpot.choose(hostPick); setHostPick(null); }}>{t(hostPick === STUDIO_SET_SPOT ? 'Host from the set again' : 'Host from here')}</button>}
      <button className="quiet-icon" aria-label={t('Close panel')} onClick={() => setHostPick(null)}><X size={18} /></button>
    </aside></RoomZone>}
    {arranging && placement !== null && <RoomZone zone="top-left"><div className={`placement-feedback ${placement ? 'valid' : 'invalid'}`} role="status">{placement ? t('Release to place') : placingSurface ? t('Put it on a table or the bar.') : placementReason ? systemText(stairPlacementText[placementReason]) : t("It doesn't fit there.")}</div></RoomZone>}
    {onAir && !uiHidden && !presenter && <RoomZone zone="top-left"><div className="studio-on-air" role="status" data-testid="studio-on-air">
      <span className="studio-on-air-badge"><i aria-hidden="true" />{t('Recording')}</span>
      {onAir.line && <p className="studio-caption" data-testid="studio-caption">{onAir.line}</p>}
    </div></RoomZone>}
    {!ready && <div className="room-loading" role="status"><BatteryMedium size={26} /><span>{t("Opening the curtains…")}</span></div>}
  </div>;
}

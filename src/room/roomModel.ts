import { baristaPresenterStep, baristaRoomCell, baristaRoomStep } from './baristaLocomotion';
import { SEATED_SHEET } from '../../shared/media';
import { SEATING_FLOOR_Y } from '../../shared/seating-profiles';
import { ownerSenderId } from '../../shared/domain';
import { prepareWindowTransmission } from './windowTransmission';
import { packForAction, seatedPackOf } from '../../shared/seated-sheet';
import { layeredNavigation } from './floorNavigation';
import { STUDIO_SET_SPOT, type StudioSet } from '../../shared/studio';
import { hostPlace, studioSetDesk, studioSetFootprints } from './studioSet';
import { studioSetVisual } from './studioSetVisual';
import { OpenFloor } from './floorGeometry';
import { isStair } from '../../shared/stairs';
import { stairPlacementError, type StairPlacementCode } from './stair-placement';
import { StairLandings } from './stairs';
import type { FloorId } from '../../shared/floors';
import type { FloorSceneView } from '../../shared/floors';
import { FurnitureLighting, isLamp } from './lighting';
import { isSpeaker } from './speakers';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Agent, BaristaAppearance, Character, Snapshot } from '../../shared/domain';
import { wallBoardCopy } from './boardCopy';
import { frameCadence } from './frameCadence';
import { frameSignature } from './frameSignature';
import { graphicsProfile, type GraphicsProfile } from './graphicsQuality';
import { clampRoomAngle, clampRoomZoom, frameRoom, roomFov } from './roomCamera';
import type { Locale } from '../../shared/locales';
import { getLocale, getTimezone, onTimezoneChange } from '../i18n';
import type { SceneryId } from '../../shared/scenery';
import { residentEnergy } from './energy';
import { layoutPois, roomLayout, residentStation, standingPois, type Poi } from './roomLayout';
import { barSpots, clampInRoom, defaultFurniture, doorway, fits, interactionsOf, moveItem, pieces as catalog, restSpots, seating, slotOf, type FurnitureItem, type FurnitureKind } from './furniture';
import { assetFurnitureView } from './assets/overlays';
import { hangOnWall } from './pieces';
import type { RoomState } from './pieces';
import { acceptVisit, cheerHolds, delivering, emptyVisits, openSpot, step, talkBubbles, tickVisits, workSpot, type Cheer, type Hold, type Motion, type StepResult, type TalkBubble, type Vec, type VisitWorld } from './behavior';
import { counterItems, newVisits, readSeen } from './overlay';
import { blocked, nearestFree, roomNav, separate } from './nav';
import { resolveCrowd } from './crowd';
import { acrylicTexture, cameraView, Card, dress, frameOf, illustrationFrame, measureImage, orientCard, releaseCardPlane, sheetLayout, singleLayout, standeeMaterial, type Layout, type StandeeUniforms } from './standee';
import { canSit, characterLooks } from './looks';
import { actionMark, actionPose, LAND_MS, LIFT, TAP_MS } from './actionLayer';
import { cardFacing, sheetCell, standingCells } from './sprites';
import { baristaCell, baristaDuration, baristaHandoff, baristaPour, baristaSheet, type BaristaAction } from '../../shared/barista-sprites';
import { baristaBodies, baristaDeliveryTarget, baristaGuestLooks, BaristaSequence } from './barista';
import { sheetFormatOf, sheetFormats, type SheetFormat } from '../../shared/sprites';
import { buildLight, buildStage } from './light';
import { clampToRect, insetRoomRect, residentDropArea, roomFloor, roomSize, roomWalls } from '../../shared/room-dimensions';
import { daylight, type Daylight } from './daylight';
import { localHour } from '../../shared/cafe-day';
import { isWindowFurniture, placedWindows, type WindowAnchor } from './windowLighting';
import { defaultRoomBrightness, minRoomBrightness, maxRoomBrightness } from '../../shared/room-lighting-settings';
import { appearanceDaylight, type RoomAppearance } from './appearance';
import { FurnitureContacts } from './contacts';
import { buildAmbience } from './ambience';
import { themeFor, type Theme } from './theme';
import { FinishSurfaces } from './finishSurfaces';
import type { RoomFinishChoice } from '../../shared/room-finishes';
import { celebrationBeats, CELEBRATION_MS } from './timeline';
import { glowLayer, type GlowTone } from './glow';
import { FurnitureAssetPool } from './assets/pool';
import { FurnitureVisual } from './assets/visual';
import { furnitureVisualRequest } from './assets/bindings';
import { furnitureMarker } from './assets/marker';
import { furnitureCoverage, type FurnitureCoverage } from './assets/coverage';
import { furnitureActionExit, furnitureActionFrame, type FurnitureActionFrame } from './furnitureAction';
import { furnitureActionCard } from './furnitureActionCard';
import { furnitureActionClock } from './furnitureActionClock';
import { actorPositionWriter } from './actorPosition';
import { projectFurnitureAction } from '../../shared/furniture-actions';
import { matchingSeating, seatingFurnitureOffset, seatingNavigation } from './seatingPose';

export interface Anchor { x: number; y: number; scale: number; width?: number; height?: number }
export interface RoomAnchors { stairs?: (Anchor & { id: string })[]; lamps?: (Anchor & { id: string; kind: FurnitureKind; on: boolean })[]; speakers?: (Anchor & { id: string })[]; residents: Anchor[]; desks: Anchor[]; energy: Anchor; notice: Anchor; counter: Anchor; barista: Anchor }
export interface ResidentPoint { id: string; headX: number; headY: number; footX: number; footY: number; width: number; mode?: string }
export type Focus = { kind: 'board'; id: 'energy' | 'notice' } | { kind: 'resident'; id: string } | { kind: 'counter' };
export type GlowTarget = 'counter' | 'energy' | 'notice';
export interface CameraView { angle: number; zoom: number; panX: number; panY: number }
export interface RoomDebugApi { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; render(): void; paintFrame(sprite: Card, col: number, row: number): void; actor: THREE.Object3D; residents: readonly Card[] }
export type RoomDebugHook = (api: RoomDebugApi) => void;
export interface RoomRenderer { placementFurniture?(items?: readonly FurnitureItem[]): void; stairs?(items: readonly FurnitureItem[], floor: FloorId): void; pickStair?(x: number, y: number): string | null; floorView?(value?: FloorSceneView): void; brightness(value: number): void; finish?(choice: RoomFinishChoice): void; appearance(mode: RoomAppearance): void; update(snapshot: Snapshot | null, scenery: SceneryId, locale: Locale): void; arrange(active: boolean): void; motion(paused: boolean): void; graphics?(profile: GraphicsProfile): void; sleep?(asleep: boolean): void; board(kind: 'energy' | 'notice' | null): void; open(listener: (panel: 'energy' | 'counter' | 'notice') => void): void; barista(character: Character, appearance?: BaristaAppearance): void; view(angle: number): void; zoomAt(factor: number, clientX: number, clientY: number): void; zoomBy(factor: number): void; panBy(dx: number, dy: number): void; resetView(): void; cameraView?(): CameraView; restoreView?(view: CameraView): void;  counterViewing(open: boolean): void; glowTarget(target: GlowTarget, reason: 'hover' | 'focus', on: boolean): void; baristaAction?(action: Exclude<BaristaAction, 'idle'>): void; present?(spot: string | null): void; shoot?(shot: PresenterShot | null): void; studioSet?(set: StudioSet | null): void; pickSet?(clientX: number, clientY: number): boolean; editors?(desks: readonly { agentId: string; furnitureId: string }[]): void; perform?(act: BaristaAction, elapsed: number): void; furniture(items: FurnitureItem[], coveredIds?: readonly string[]): void; retryFurniture(): void; select(id: string | null): void; pickPiece(clientX: number, clientY: number): string | null; dragPiece(id: string, clientX: number, clientY: number): { x: number; z: number; ok: boolean; reason?: StairPlacementCode } | null; endDrag(): void; follow(listener: (points: ResidentPoint[]) => void): void; talk(listener: (bubbles: TalkBubble[]) => void): void; counter(listener: (count: number) => void): void; grab(id: string): void; drag(id: string, clientX: number, clientY: number): void; drop(id: string): void; cancel(id: string): void; poke(id: string): void; cheers(active: Record<string, Cheer>): void; toggleLamp(id: string): boolean | null; capture?(width: number, height: number, background: string): HTMLCanvasElement | null; pokeAt(clientX: number, clientY: number): string | null; dispose(): void }


/** A front camera on the presenter: the script's zoom 1–3, and how far it has turned from the host (0) to the spot's desk (1). */
export interface PresenterShot { zoom: number; toward: number }

export function buildRoom(host: HTMLDivElement, onAnchors: (anchors: RoomAnchors) => void, onReady: () => void, onFailure: () => void, options: { activeFloor?: FloorId; stairways?: FurnitureItem[]; floorView?: FloorSceneView; persistLights?: boolean; furniture?: FurnitureItem[]; placementFurniture?: readonly FurnitureItem[]; coveredFurniture?: readonly string[]; appearance?: RoomAppearance; brightness?: number; status?(coverage: FurnitureCoverage): void; debug?: RoomDebugHook; graphics?: GraphicsProfile; frameHeight?: number; studioSet?: StudioSet | null }): RoomRenderer {
  let floorView = options.floorView;
  // A canvas framed as if it were `frameHeight` CSS pixels tall: the camera's distance cap and the wall boards' phone layout follow that size, not the real one.
  const framed = (width: number, height: number) => options.frameHeight ? { width: width * options.frameHeight / height, height: options.frameHeight } : { width, height };
  const framedWidth = () => framed(host.clientWidth, host.clientHeight || 1).width;
  let activeFloor=options.activeFloor??0, stairways=options.stairways??[];
  const stations = roomLayout.workSeats.map(v => new THREE.Vector3(v.x, 0, v.z));
  const tables = roomLayout.stations.map(v => new THREE.Vector3(v.x, 0, v.z));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(roomFov, 16 / 10, .5, 400);
  let cameraAngle = 0, cameraZoom = 1, cameraPanX = 0, cameraPanY = 0;
  let graphics = options.graphics ?? graphicsProfile('high');
  const renderer = new THREE.WebGLRenderer({ antialias: graphics.antialias, alpha: true, stencil: true, powerPreference: 'low-power' }); renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, graphics.maxPixelRatio)); renderer.shadowMap.enabled = graphics.shadows !== 'off';
  renderer.shadowMap.type = graphics.shadows === 'simple' ? THREE.BasicShadowMap : THREE.PCFShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  host.dataset.graphics = graphics.tier; renderer.domElement.setAttribute('aria-hidden', 'true'); renderer.domElement.dataset.sceneId = crypto.randomUUID(); host.appendChild(renderer.domElement);
  renderer.domElement.dataset.roomLayout = `${roomSize.width}x${roomSize.depth}`;
  const contextLost = (event: Event) => { event.preventDefault(); onFailure(); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost, { once: true });
  const materials = new Set<THREE.Material>(); const geometries = new Set<THREE.BufferGeometry>(); const textures = new Set<THREE.Texture>();
  const mat = (color: string | number, roughness = .85) => { const m = new THREE.MeshStandardMaterial({ color, roughness }); materials.add(m); return m; };
  const cream = mat('#f8dfbb');
  const floorEdge = mat('#a87451');
  let theme: Theme = themeFor('peach');
  const themed = { wall: mat(theme.wall), floor: new THREE.MeshStandardMaterial({ color: theme.floor, roughness: .85, vertexColors: true }) };
  materials.add(themed.floor); const leftWall = mat(theme.wall), seamWood = mat('#d9ae77'); const kept = new Set<THREE.Material>([...Object.values(themed), leftWall, seamWood]);
  const tints = new Map<string, THREE.MeshStandardMaterial>();
  const group = new THREE.Group(); scene.add(group);
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) {
    geometries.add(geometry); const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  }
  function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, radius = .04, parent: THREE.Object3D = group) {
    return mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), material, x, y, z, parent);
  }
  function cylinder(r1: number, r2: number, h: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) {
    return mesh(new THREE.CylinderGeometry(r1, r2, h, 32), material, x, y, z, parent);
  }
  const track = { material: <T extends THREE.Material>(m: T) => (materials.add(m), m), geometry: <T extends THREE.BufferGeometry>(g: T) => (geometries.add(g), g), texture: <T extends THREE.Texture>(t: T) => (textures.add(t), t) };
  const shadowGround = new THREE.ShadowMaterial({ color: '#655a3e', opacity: .08 }); materials.add(shadowGround);
  const ground = mesh(new THREE.PlaneGeometry(200, 200), shadowGround, 0, -.46, 0, scene); ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const closedFloor=new THREE.Group();group.add(closedFloor);
  box(roomSize.width, .64, roomSize.depth, floorEdge, roomSize.centreX, -.14, roomSize.centreZ, .17, closedFloor);
  const stage = buildStage(scene, track, -.46);
  for (let i = 0; i < Math.floor((roomSize.width - .25) / .398); i++) {
    const tone = 1 + ((i * 7) % 9 - 4) * .014, x = roomFloor.minX + .33 + i * .398;
    box(.395, .045, roomSize.depth - .2, themed.floor, x, .2, roomSize.centreZ, .008, closedFloor).userData.tone = [tone, tone, tone];
    for (let seam = roomFloor.minZ + 1.8; seam < roomFloor.maxZ - 1.8; seam += 3.2) box(.39, .006, .013, seamWood, x, .226, seam + (i % 3) * .24, 0, closedFloor);
  }
  mergeStatic(closedFloor, new Set());
  const surfaces = new FinishSurfaces({ back: themed.wall, left: leftWall, floor: themed.floor, closedFloor, planks: closedFloor.children.filter(child => child instanceof THREE.Mesh && (child.material === themed.floor || child.material === seamWood)) });
  const openFloor=new OpenFloor(themed.floor,floorEdge);group.add(openFloor.root);openFloor.update(stairways);
  closedFloor.visible=activeFloor===0||!stairways.length;openFloor.root.visible=!closedFloor.visible;
  const wallMat = themed.wall;
  const { back, left, height, thickness, top } = roomWalls;
  box(roomSize.width, height, thickness, wallMat, roomSize.centreX, top - height / 2, back.z - thickness / 2, .07).castShadow = false;
  box(thickness, height, roomSize.depth - .1, leftWall, left.x - thickness / 2, top - height / 2, roomSize.centreZ, .07).castShadow = false;
  box(roomSize.width - .2, .14, .1, cream, roomSize.centreX, .35, back.z + .05); box(.1, .14, roomSize.depth - .3, cream, left.x + .05, .35, roomSize.centreZ);
  const light = buildLight(scene, renderer, group, track); light.shadowDetail(graphics.shadows === 'simple');
  const models = new FurnitureAssetPool();
  const stairLandings = new StairLandings(models, () => { renderer.shadowMap.needsUpdate = true; render(); }); group.add(stairLandings.root);
  stairLandings.update(options.stairways ?? [], options.activeFloor ?? 0);
  const landingMark = new THREE.Group(); group.add(landingMark);
  const ring = mesh(new THREE.TorusGeometry(.46, .045, 5, 24), mat('#c5b68b'), 0, .255, 0, landingMark); ring.rotation.x = Math.PI / 2;
  box(.95, .035, .06, mat('#a77349'), 0, .26, -.55, .01, landingMark);
  landingMark.visible = false;
  const furnitureRoot = new THREE.Group(); group.add(furnitureRoot);
  let coveredFurniture = new Set(options.coveredFurniture);
  let appearance = options.appearance ?? 'original';
  const boundedBrightness = (value: number) => Number.isFinite(value) ? Math.max(minRoomBrightness, Math.min(maxRoomBrightness, value)) : defaultRoomBrightness;
  let roomBrightness = boundedBrightness(options.brightness ?? defaultRoomBrightness); host.dataset.brightness = String(roomBrightness);
  host.dataset.appearance = appearance;
  const contacts = new FurnitureContacts(); scene.add(contacts.mesh); contacts.mesh.visible = appearance === 'polished';
  let layoutKey = '';
  /** The studio set standing on this floor, drawn from public/creator; the furniture it covers is already left out of `furniture`. */
  let studioSet = options.studioSet ?? null, setView: Awaited<ReturnType<typeof studioSetVisual>> | undefined, setGeneration = 0;
  /** Residents editing a laptop's self-media project: they work at that laptop instead of their own table. */
  let editorDesks: readonly { agentId: string; furnitureId: string }[] = [];
  let presenterShot: PresenterShot | null = null;
  const overlayShared = { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() };
  mergeStatic(group, new Set([furnitureRoot, landingMark, stairLandings.root, closedFloor, openFloor.root]));
  const ambience = buildAmbience(group, track, roomLayout.stations);
  let furniture: FurnitureItem[] = [...defaultFurniture];
  let placementFurniture = options.placementFurniture;
  const placement = (candidate: FurnitureItem): { ok: boolean; reason?: StairPlacementCode } => {
    const layout = placementFurniture ?? [...furniture, ...stairways.filter(stair => !furniture.some(item => item.id === stair.id))];
    const fit = fits(candidate, layout), stairError = stairPlacementError(layout.map(item => item.id === candidate.id ? candidate : item));
    return { ok: fit && !stairError, reason: stairError && (fit || isStair(candidate)) ? stairError.code : undefined };
  };
  type LivePiece = { item: FurnitureItem; node: THREE.Group; view: FurnitureVisual; key: string; index: number; poked: number };
  const live = new Map<string, LivePiece>();
  let preferences: Storage | undefined;
  try { if (options.persistLights !== false) preferences = localStorage; } catch { preferences = undefined; }
  const lamps = new FurnitureLighting(scene, preferences);
  let defaultLampOn = daylight(localHour(Date.now(), getTimezone())).lamp > .5;
  let windows: WindowAnchor[] = []; let lightingDirty = true;
  let selected: string | null = null; let moving: { id: string; dx: number; dz: number; x: number; z: number; ok: boolean; reason?: StairPlacementCode } | null = null;
  const glow = glowLayer(); let hovered: string | null = null;
  const targetLit: Record<GlowTarget, Set<'hover' | 'focus'>> = { counter: new Set(), energy: new Set(), notice: new Set() };
  const gridPoints: number[] = [];
  const gridEdge = insetRoomRect(roomFloor, .15);
  for (let x = gridEdge.minX; x <= gridEdge.maxX + 1e-6; x += .25) gridPoints.push(x, .24, gridEdge.minZ, x, .24, gridEdge.maxZ);
  for (let z = gridEdge.minZ; z <= gridEdge.maxZ + 1e-6; z += .25) gridPoints.push(gridEdge.minX, .24, z, gridEdge.maxX, .24, z);
  const gridGeometry = track.geometry(new THREE.BufferGeometry());
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
  const grid = new THREE.LineSegments(gridGeometry, track.material(new THREE.LineBasicMaterial({ color: '#496b63', transparent: true, opacity: .28, depthWrite: false })));
  grid.visible = false; group.add(grid);
  function placeGlow() {
    const id = moving?.id ?? selected; const item = furniture.find(entry => entry.id === id); const tone: GlowTone = moving && !moving.ok ? 'blocked' : 'ok';
    host.dataset.selected = item && !item.stowed ? `${item.id}:${tone}` : '';
    const targets = new Map<THREE.Object3D, GlowTone>();
    const light = (pieceId: string | null | undefined, as: GlowTone) => { const node = pieceId ? live.get(pieceId)?.node : undefined; if (node && !targets.has(node)) targets.set(node, as); };
    light(item && !item.stowed ? item.id : null, tone);
    const piece = (kind: FurnitureKind) => furniture.find(entry => entry.kind === kind && !entry.stowed)?.id;
    if (viewingCounter || targetLit.counter.size) light(piece('bar'), 'ok');
    if (targetLit.energy.size) light(piece('workBoard'), 'ok');
    if (targetLit.notice.size) light(piece('noticeBoard'), 'ok');
    light(hovered, 'hover');
    glow.set(targets);
  }
  const reservedNavigation = seatingNavigation();
  const floorNavigation=()=>{const base=roomNav(furniture);return activeFloor===1||stairways.length||studioSet?layeredNavigation(furniture,stairways,activeFloor,studioSet?studioSetFootprints(studioSet):[]):base;};
  const actionNavigation = () => reservedNavigation(floorNavigation(), furniture, currentSnapshot?.furnitureActions?.actors ?? [], actionClock.at(performance.now()));
  const pieceKey = (item: FurnitureItem, index: number) => `${item.kind}:${item.variant}:${item.size ?? 1}:${item.wall ?? ''}:${item.kind === 'table' ? index : 0}`;
  function publishFurniture() {
    const coverage = furnitureCoverage([...live.values()].map(piece => piece.view.status));
    const items = [...live.values()].sort((a, b) => a.item.id.localeCompare(b.item.id)).map(piece => {
      piece.node.updateWorldMatrix(true, true);
      const position = piece.node.getWorldPosition(new THREE.Vector3());
      const status = piece.view.status;
      const bounds = new THREE.Box3().setFromObject(piece.node);
      return { id: piece.item.id, productId: piece.item.productId ?? null, kind: piece.item.kind, variant: piece.item.variant,
        x: position.x, y: position.y, z: position.z, turn: (Math.round(-piece.node.rotation.y / (Math.PI / 2)) % 4 + 4) % 4,
        stowed: false, visible: piece.node.visible, status: status.phase, assetId: 'asset' in status ? status.asset : null,
        matrix: piece.node.matrixWorld.toArray(), modelMatrix: piece.node.children[0]?.matrixWorld.toArray(),
        bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() } };
    });
    const layout = JSON.stringify({ ready: items.every(item => item.status === 'ready'), items });
    if (host.dataset.furnitureLayout !== layout) {
      host.dataset.furnitureLayout = layout;
      host.dataset.furnitureLayoutGeneration = String(Number(host.dataset.furnitureLayoutGeneration ?? 0) + 1);
    }
    for (const [key, value] of Object.entries(coverage)) host.dataset[`furniture${key[0].toUpperCase()}${key.slice(1)}`] = String(value);
    options.status?.(coverage);
  }
  function placeLamps() {
    lamps.sync([...live.values()].flatMap(piece => piece.view.lamp ? [{ id: piece.item.id, lamp: piece.view.lamp }] : []), defaultLampOn);
    lamps.allocate(camera);
    host.dataset.lamps = JSON.stringify([...live.values()].filter(piece => piece.view.lamp).map(piece => ({ id: piece.item.id, on: lamps.isOn(piece.item.id) })));
    host.dataset.localLights = String(lamps.lights.filter(light => light.intensity > 0).length);
  }
  function toggleLamp(id: string) {
    if (grid.visible) return null;
    const on = lamps.toggle(id);
    if (on !== null) { placeLamps(); anchors(); render(); }
    return on;
  }
  function placePiece(item: FurnitureItem, node: THREE.Group, host?: FurnitureItem) {
    if (isWindowFurniture(item.kind)) lightingDirty = true;
    const spec = catalog[item.kind];
    if (spec.mount === 'wall') { hangOnWall(node, item.wall ?? 'back', item.wall === 'left' ? item.z : item.x, spec.hang!); return; }
    const at = spec.mount === 'surface' ? slotOf(item, furniture, host) : null;
    node.userData.baseY = at?.y ?? 0; node.position.set(at?.x ?? item.x, node.userData.baseY, at?.z ?? item.z); node.userData.baseRotationY = (at?.rotationY ?? 0) - item.turn * Math.PI / 2; node.rotation.set(0, node.userData.baseRotationY, 0);
  }
  function placeRiders(host: FurnitureItem) {
    for (const piece of live.values()) if (piece.item.on === host.id && catalog[piece.item.kind].mount === 'surface') placePiece(piece.item, piece.node, host);
  }
  function buildPiece(item: FurnitureItem, index: number): LivePiece {
    const view = new FurnitureVisual({
      id: item.id, models,
      asset: (node, asset) => {
        const disposeGlass = isWindowFurniture(piece.item.kind) ? prepareWindowTransmission(node) : undefined;
        try { const view = assetFurnitureView(piece.item, node, overlayShared, asset); return { ...view, dispose() { view.dispose(); disposeGlass?.(); } }; }
        catch (error) { disposeGlass?.(); throw error; }
      },
      marker: status => furnitureMarker(catalog[piece.item.kind], status),
      beforeSwap: () => glow.invalidate(view.node),
      afterSwap: () => { lightingDirty = true; publishFurniture(); placeLamps(); paintCurrentBoards(); placeGlow(); anchors(); renderer.shadowMap.needsUpdate = true; render(); },
    });
    view.appearance(appearance);
    const node = view.node; furnitureRoot.add(node); placePiece(item, node);
    const piece: LivePiece = { item, node, view, key: pieceKey(item, index), index, poked: -Infinity };
    return piece;
  }
  let bar = barSpots(furniture);
  let counter = { ...bar.counter }; let counterTop = counter.height + .08;
  function layFurniture(items: readonly FurnitureItem[]) {
    lightingDirty = true;
    furniture = [...items]; layoutKey = JSON.stringify(items);
    const allTables = items.filter(item => item.kind === 'table');
    for (const [id, piece] of live) if (!items.some(item => item.id === id) || items.find(item => item.id === id)?.stowed) { piece.view.dispose(); live.delete(id); }
    for (const item of items) {
      if (item.stowed) continue;
      const index = Math.max(0, allTables.indexOf(item)); const key = pieceKey(item, index); let piece = live.get(item.id);
      if (!piece) { piece = buildPiece(item, index); live.set(item.id, piece); }
      piece.item = item; piece.index = index; piece.key = key; placePiece(item, piece.node);
      void piece.view.set(furnitureVisualRequest(item, key, coveredFurniture.has(item.id)));
    }
    placeLamps(); publishFurniture();
    bar = barSpots(furniture); counter = { ...bar.counter }; counterTop = counter.height + .08;
    const seated = seating(items).work;
    allTables.forEach((table, i) => {
      if (table.stowed) return;
      const seat = seated.find(entry => entry.table.id === table.id)?.seat ?? { x: table.x, z: table.z - .9 };
      tables[i]?.set(table.x, 0, table.z); stations[i]?.set(seat.x, 0, seat.z); ambience.place(i, table);
    });
    placeBarista();
    const counterBar = furniture.find(item => item.kind === 'bar' && !item.stowed);
    counterSlots.forEach((slot, k) => {
      const at = bar.surface[k]; if (at) slot.slot.position.set(at.x, at.y, at.z);
      slot.slot.rotation.y = -(counterBar?.turn ?? 0) * Math.PI / 2;
      slot.cup.rotation.y = counterBar && ['collect_daybreak_bar_core_v1', 'collect_fjord_bar_core_v1', 'collect_forma_bar_core_v1', 'collect_teak_bar_core_v1'].includes(counterBar.variant) ? Math.PI / 2 : 0;
      slot.letter.rotation.y = counterBar?.variant.startsWith('collect_') ? Math.PI / 2 : .25;
    });
    const nav = roomNav(furniture);
    pois = layoutPois(furniture).map(poi => poi.activity === 'sit' ? poi : { ...poi, spots: poi.spots.filter(spot => !blocked(nav, spot)) }).filter(poi => poi.spots.length);
    placeGlow(); paintCurrentBoards(); renderer.shadowMap.needsUpdate = true;
  }
  let pois: Poi[] = [];
  const itemColours = ['#e79a78', '#7fa37a', '#9d8fc4', '#d9a84e', '#5f9a97', '#c97f8f'];
  const coffeeFinish = mat('#6b3c20', .6);
  const counterSlots = Array.from({ length: 6 }, (_, k) => {
    const finish = track.material(new THREE.MeshStandardMaterial({ color: itemColours[k], roughness: .55 }));
    const slot = new THREE.Group(); slot.position.set(counter.x - .6 + k * .3, counterTop, counter.z + .1); slot.visible = false; group.add(slot);
    const cup = new THREE.Group(); slot.add(cup);
    cylinder(.1, .082, .21, finish, 0, .105, 0, cup).castShadow = false; const grip = mesh(new THREE.TorusGeometry(.06, .018, 8, 16), finish, 0, .11, .11, cup); grip.rotation.y = Math.PI / 2; grip.castShadow = false;
    cylinder(.087, .087, .006, coffeeFinish, 0, .211, 0, cup).castShadow = false;
    const letter = box(.24, .03, .32, finish, 0, .016, 0, .01, slot); letter.rotation.y = .25; letter.castShadow = false;
    return { slot, cup, letter, finish, item: '', since: 0 };
  });
  let counterChecked = 0;
  let viewingCounter = false, cleanupPending = false;
  let serviceResult: { id: string; slot: number } | null = null;
  let handoff: { key: number; since: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  let releasedKey = 0;
  const serviceCup = new THREE.Group(); serviceCup.visible = false; group.add(serviceCup);
  const serviceFinish = mat('#fff7e2', .55);
  cylinder(.1, .082, .21, serviceFinish, 0, .105, 0, serviceCup).castShadow = false;
  const serviceGrip = mesh(new THREE.TorusGeometry(.06, .018, 8, 16), serviceFinish, 0, .11, .11, serviceCup); serviceGrip.rotation.y = Math.PI / 2; serviceGrip.castShadow = false;
  cylinder(.087, .087, .006, coffeeFinish, 0, .211, 0, serviceCup).castShadow = false;
  const pourFinish = new THREE.MeshBasicMaterial({ color: '#66d9e7', toneMapped: false }); materials.add(pourFinish);
  const pour = mesh(new THREE.CylinderGeometry(.018, .018, 1, 6), pourFinish, 0, 0, 0, group); pour.visible = false; pour.castShadow = false;
  function artPoint(x: number, y: number) {
    const layout = baristaStand.userData.layout as Layout, bounds = frameOf(layout);
    baristaStand.updateMatrixWorld(true);
    return new THREE.Vector3((x - bounds.l) / (bounds.r - bounds.l) - .5, (bounds.b - y) / (bounds.b - bounds.t) - .5, .012).applyMatrix4(baristaStand.matrixWorld);
  }
  const baristaPerformance = new BaristaSequence();
  function layCounter(time: number) {
    const snapshot = currentSnapshot; counterChecked = time;
    const waiting = new Set(delivering(visitWorld));
    const items = snapshot ? counterItems(snapshot, id => readSeen(snapshot.house, id)).filter(item => !waiting.has(item.id)).slice(0, counterSlots.length) : [];
    let arrived = false, cleared = false;
    counterSlots.forEach((slot, k) => {
      const item = items[k];
      if (!item) { if (slot.item) cleared = true; slot.slot.visible = false; slot.item = ''; return; }
      // Cups sit on this floor's bar; a floor without one (2F) keeps them hidden instead of floating where the 1F bar is.
      const onBar = Boolean(bar.surface[k]);
      if (slot.item !== item.id) { slot.item = item.id; slot.since = time; arrived = true; if (onBar && item.kind === 'result' && baristaStand.userData.baristaSheet && !serviceResult && !reduced.matches && !paused) serviceResult = { id: item.id, slot: k }; }
      slot.slot.visible = onBar; slot.cup.visible = item.kind === 'result' && serviceResult?.id !== item.id; slot.letter.visible = item.kind === 'note';
      slot.finish.color.set(itemColours[Math.max(0, agents.findIndex(agent => agent.id === item.agentId)) % itemColours.length]);
      const grow = reduced.matches || paused ? 1 : Math.min(1, (time - slot.since) / 260); slot.slot.scale.setScalar(.2 + .8 * (1 - (1 - grow) ** 3));
    });
    if (arrived) { baristaPerformance.cue('brew', time); baristaPerformance.cue('serve', time); }
    else if (cleared) { serviceResult = null; handoff = null; serviceCup.visible = false; cleanupPending = true; }
    if (host.dataset.counter !== String(items.length)) { host.dataset.counter = String(items.length); onCounter(items.length); }
  }
  function mergeStatic(root: THREE.Object3D, keep: Set<THREE.Object3D>) {
    root.updateMatrixWorld(true); const inverse = root.matrixWorld.clone().invert();
    const buckets = new Map<string, { material: THREE.Material; cast: boolean; parts: THREE.BufferGeometry[] }>();
    const tint = (roughness: number, metalness: number) => {
      const key = `${roughness}:${metalness}`; let m = tints.get(key);
      if (!m) { m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness }); materials.add(m); tints.set(key, m); }
      return m;
    };
    const visit = (node: THREE.Object3D) => {
      if (keep.has(node)) return;
      [...node.children].forEach(visit);
      if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.Material)) return;
      const source = node.material; const tinted = source instanceof THREE.MeshStandardMaterial && !kept.has(source) && !source.map;
      const key = `${tinted ? `tint:${source.roughness}:${source.metalness}` : source.uuid}:${node.castShadow}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = { material: tinted ? tint(source.roughness, source.metalness) : source, cast: node.castShadow, parts: [] });
      const part = node.geometry.clone().applyMatrix4(inverse.clone().multiply(node.matrixWorld));
      for (const name of Object.keys(part.attributes)) if (!['position', 'normal', 'uv'].includes(name)) part.deleteAttribute(name);
      if (!part.index) part.setIndex([...Array(part.attributes.position.count).keys()]);
      if (!tinted && source.vertexColors) { const tone: number[] = node.userData.tone ?? [1, 1, 1]; part.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: part.attributes.position.count }, () => tone).flat(), 3)); }
      if (tinted) part.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: part.attributes.position.count }, () => [source.color.r, source.color.g, source.color.b]).flat(), 3));
      bucket.parts.push(part);
      node.removeFromParent(); geometries.delete(node.geometry); node.geometry.dispose();
    };
    [...root.children].forEach(visit);
    for (const { material, cast, parts } of buckets.values()) {
      materials.add(material);
      mesh(mergeGeometries(parts), material, 0, 0, 0, root).castShadow = cast;
      parts.forEach(part => part.dispose());
    }
  }
  const textureLoader = new THREE.TextureLoader();
  const actionCards: ReturnType<typeof furnitureActionCard>[] = [];
  const sprites: Card[] = []; const shadows: THREE.Mesh[] = []; const bases: THREE.Mesh[] = [];
  const acrylic = new THREE.MeshBasicMaterial({ map: acrylicTexture(), transparent: true, depthWrite: false, toneMapped: false }); materials.add(acrylic); textures.add(acrylic.map!);
  const maps = new Map<string, THREE.Texture>();
  const failed = new Set<string>();
  function avatarTexture(path: string) {
    const existing = maps.get(path); if (existing) return existing;
    const texture = textureLoader.load(path, () => {
      if (disposed) return;
      texture.needsUpdate = true;
      applySnapshot(currentSnapshot, currentScenery, currentLocale);
    }, undefined, () => { if (disposed) return; failed.add(path); applySnapshot(currentSnapshot, currentScenery, currentLocale); });
    texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture); maps.set(path, texture);
    return texture;
  }
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d')!; const radial = ctx.createRadialGradient(64, 64, 4, 64, 64, 60); radial.addColorStop(0, '#49332380'); radial.addColorStop(1, '#49332300'); ctx.fillStyle = radial; ctx.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas); textures.add(shadowTexture);
  function size(sprite: Card, width: number, height: number, top = height) { sprite.scale.set(width, height, 1); sprite.userData.base = { width, height, top }; }
  const baseSize = (sprite: Card): { width: number; height: number; top: number } => sprite.userData.base ?? { width: 2, height: 2, top: 2 };
  const layouts = new Map<string, Layout>();
  const illustrationFrames = new Map<string, THREE.Texture>();
  function measured(path: string, image: HTMLImageElement, sheet?: SheetFormat) {
    let layout = layouts.get(path);
    if (!layout) {
      const full = { l: 0, t: 0, r: 1, b: 1 };
      const { rows, facings } = sheetFormats[sheet ?? 'eight'];
      if (sheet) layout = sheetLayout(measureImage(image, 8, rows, standingCells(sheet), facings.length) ?? { union: full, idle: full, pixel: false }, image.height, rows);
      else layout = singleLayout(measureImage(image, 1, 1, [[0, 0]]), image.width, image.height);
      layouts.set(path, layout);
    }
    return layout;
  }
  function wear(sprite: Card, source: THREE.Texture, layout: Layout, col: number, row: number) {
    if (sprite.material.map && !sprite.material.map.userData.isolatedFrame) { textures.delete(sprite.material.map); sprite.material.map.dispose(); }
    const map = source.clone(); map.needsUpdate = true; textures.add(map);
    sprite.material.map = map; sprite.userData.source = source; sprite.userData.layout = layout; paintFrame(sprite, col, row);
    sprite.material.needsUpdate = true;
    const f = frameOf(layout); sprite.center.copy(f.center); size(sprite, f.width, f.height, f.top);
    const radius = Math.min(.62, Math.max(.36, (layout.crop.r - layout.crop.l) * layout.cellAspect * layout.unit * .34));
    bases[sprites.indexOf(sprite)]?.scale.set(radius, radius, 1);
  }
  function paintFrame(sprite: Card, col: number, row: number) {
    const layout = sprite.userData.layout as Layout, source = sprite.userData.source as THREE.Texture;
    if (!layout.pixel) {
      const key = `${source.uuid}:${col}:${row}`; let isolated = illustrationFrames.get(key);
      if (!isolated) {
        const frame = illustrationFrame(source.image as HTMLImageElement, layout.cols, layout.rows, col, row);
        if (frame) { frame.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); textures.add(frame); illustrationFrames.set(key, frame); isolated = frame; }
      }
      if (isolated) {
        const previous = sprite.material.map;
        if (previous && !previous.userData.isolatedFrame) { textures.delete(previous); previous.dispose(); }
        sprite.material.map = isolated;
        dress(isolated, sprite.userData.uniforms, { ...layout, cols: 1, rows: 1 }, 0, 0);
        return;
      }
    }
    dress(sprite.material.map!, sprite.userData.uniforms, layout, col, row);
  }
  function addResident(i: number) {
    const actionCard = furnitureActionCard(); actionCards.push(actionCard);
    if (!stations[i]) {
      const v = residentStation(i, furniture); stations.push(new THREE.Vector3(v.x, 0, v.z - .9));
    }
    const { material: m, uniforms } = standeeMaterial(); materials.add(m);
    const sprite = new Card(m); sprite.userData.uniforms = uniforms; sprite.center.set(.5, .045); size(sprite, 2.12, 2.12); sprite.position.set(stations[i].x, .3, stations[i].z); sprite.visible = false; group.add(sprite); sprites.push(sprite);
    const sm = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: .52 }); materials.add(sm);
    const shadow = mesh(new THREE.PlaneGeometry(1.45, .98), sm, stations[i].x, .273, stations[i].z); shadow.rotation.x = -Math.PI / 2; shadow.visible = false; shadow.castShadow = false; shadows.push(shadow);
    const base = mesh(new THREE.CircleGeometry(1, 48), acrylic, stations[i].x, .28, stations[i].z); base.rotation.x = -Math.PI / 2; base.scale.set(.45, .45, 1); base.visible = false; base.castShadow = false; base.receiveShadow = false; base.renderOrder = 1; bases.push(base);
  }
  for (let i = 0; i < 3; i++) addResident(i);
  const baristaStand = (() => {
    const { material: m, uniforms } = standeeMaterial(); materials.add(m);
    const sprite = new Card(m); sprite.userData.uniforms = uniforms; sprite.center.set(.5, .045); size(sprite, 2.12, 2.12);
    sprite.flip = -1;
    sprite.position.set(roomLayout.barista.x, .3, roomLayout.barista.z); sprite.visible = false; group.add(sprite); return sprite;
  })();
  // The seated barista is a second card so the walking and service art keep their own layout and frames.
  const baristaSeat = (() => {
    const { material: m, uniforms } = standeeMaterial(); materials.add(m);
    const sprite = new Card(m); sprite.userData.uniforms = uniforms; sprite.visible = false; group.add(sprite); return sprite;
  })();
  let baristaMotion: Motion | undefined;
  /** A performance in this room: where the barista hosts it and the act playing, counted from `since` on the room clock. */
  let presenting: { spot: string; act: BaristaAction; since: number } | null = null;
  let presenterPlace: { key: string; place: ReturnType<typeof hostPlace> } | null = null;
  let onStage = false;
  /** The standing card is hidden while the seated card shows; animate puts it back first so other visibility rules still apply. */
  let standHiddenForSeat = false;
  function presenterPlaceNow() {
    if (!presenting || activeFloor === 0 || grid.visible) return null;
    const key = `${layoutKey}|${presenting.spot}|${JSON.stringify(studioSet)}`;
    if (presenterPlace?.key !== key) presenterPlace = { key, place: hostPlace(furniture, presenting.spot, studioSet) };
    return presenterPlace.place;
  }
  function seatedLook() {
    const path = baristaOwn?.seated ? `/media/${baristaOwn.seated.key}` : null;
    if (!path || failed.has(path)) return null;
    const source = avatarTexture(path), image = source.image as HTMLImageElement | undefined;
    if (!image) return null;
    if (image.width !== SEATED_SHEET.width || image.height !== SEATED_SHEET.height) { failed.add(path); return null; }
    if (baristaSeat.userData.character !== path) {
      // The crop is padded by frameOf's two pixels so a cell maps exactly onto the card; the hip mark of the S row anchors it on the seat.
      const pad = 2 / SEATED_SHEET.cell, cells = SEATED_SHEET.width / SEATED_SHEET.cell;
      const layout: Layout = { cols: cells, rows: cells, crop: { l: pad, t: pad, r: 1 - pad, b: 1 - pad }, foot: 1, middle: .5, cellAspect: 1, cellPx: SEATED_SHEET.cell, unit: SEATED_SHEET.worldHeight, pixel: false };
      wear(baristaSeat, source, layout, SEATED_SHEET.firstColumn + SEATED_SHEET.frames - 1, 0);
      baristaSeat.center.set(128 / SEATED_SHEET.cell, 1 - 217 / SEATED_SHEET.cell); size(baristaSeat, SEATED_SHEET.worldHeight, SEATED_SHEET.worldHeight);
      baristaSeat.userData.character = path;
    }
    return path;
  }
  function placeBarista() {
    if (activeFloor !== 0) {
      const at = baristaMotion?.position ?? nearestFree(actionNavigation(), { x: 0, z: 1.5 });
      if (at) baristaStand.position.set(at.x, .3, at.z);
      return;
    }
    baristaStand.position.set(bar.barista.x, .3 + (bar.barista.y ?? 0), bar.barista.z);
    if (baristaStand.userData.baristaAnchored) baristaStand.position.y += Math.max(0, counterTop + .06 - artPoint(baristaHandoff.base[0], baristaHandoff.base[1]).y);
  }
  let baristaLook: Character = 'gpt'; let baristaOwn: BaristaAppearance | undefined;
  function dressBarista() {
    standHiddenForSeat = false;
    const body = baristaBodies(baristaLook, baristaOwn, activeFloor !== 0 && !onStage).find(item => !failed.has(item.src));
    const path = body?.src;
    const key = path ? `${baristaLook}:${activeFloor}:${onStage}:${path}` : undefined;
    if (!key || baristaStand.userData.character !== key) {
      baristaStand.visible = false; baristaStand.userData.baristaSheet = false; baristaStand.userData.baristaAnchored = false; baristaStand.userData.locomotion = false;
      delete baristaStand.userData.character;
      serviceCup.visible = false; pour.visible = false; handoff = null;
      host.dataset.baristaSource = path ? 'loading' : 'unavailable';
    }
    if (!path) return;
    const source = avatarTexture(path); const image = source.image as HTMLImageElement | undefined;
    if (!image) return;
    if (baristaStand.userData.character !== key) {
      if (body?.kind === 'locomotion') {
        if (image.width !== 2048 || image.height !== 1024) { failed.add(path); dressBarista(); return; }
        wear(baristaStand, source, measured(path, image, 'four'), 0, 0);
        baristaStand.userData.locomotion = true; baristaStand.userData.baristaSheet = false;
      } else if (body?.kind === 'sheet') {
        if (image.width !== baristaSheet.width || image.height !== baristaSheet.height) { failed.add(path); dressBarista(); return; }
        const measured = measureImage(image, baristaSheet.cols, baristaSheet.rows, Array.from({ length: baristaSheet.cols }, (_, col): [number, number] => [col, 0]));
        const layout = { ...sheetLayout(measured ?? { union: { l: 0, t: 0, r: 1, b: 1 }, idle: { l: 0, t: 0, r: 1, b: 1 }, pixel: false }, image.height, baristaSheet.rows), cols: baristaSheet.cols };
        wear(baristaStand, source, layout, 0, 0); baristaStand.userData.baristaSheet = true; baristaStand.userData.baristaAnchored = body.anchored;
      } else { wear(baristaStand, source, measured(path, image), 0, 0); baristaStand.userData.baristaSheet = false; }
      baristaStand.flip = activeFloor === 0 ? -1 : 1;
      placeBarista();
      baristaStand.userData.character = key; baristaPerformance.cue('greet', performance.now());
    }
    host.dataset.baristaSource = baristaStand.userData.locomotion ? 'custom-locomotion' : baristaStand.userData.baristaSheet ? baristaStand.userData.baristaAnchored ? 'action-sheet' : 'custom-sheet' : baristaOwn?.standee && path === `/media/${baristaOwn.standee.key}` ? 'custom-standee' : 'standee-fallback';
    baristaStand.visible = !floorView || floorView.floorId === activeFloor;
  }
  let currentSnapshot: Snapshot | null = null; let currentLocale = getLocale(); let currentScenery: SceneryId = 'sage';
  let activeBoard: 'energy' | 'notice' | null = null;
  let onOpen: (panel: 'energy' | 'counter' | 'notice') => void = () => {};
  // Boards keep the daylight tint through every repaint; a white repaint after each snapshot made them flash once a minute.
  const paintCurrentBoards = () => {
    const copy = wallBoardCopy(currentSnapshot, currentLocale, framedWidth() < 700);
    const state = (lines: string[], active: boolean): RoomState => ({ locale: currentLocale, theme, mobile: framedWidth() < 700, board: { lines, active, indicators: copy.indicators, residents: copy.residents }, tint: light_.boards, notices: currentSnapshot?.houseNotices?.map(notice => notice.title) ?? [] });
    for (const piece of live.values()) {
      if (!piece.view.refresh) continue;
      const lines = piece.item.kind === 'workBoard' ? copy.performance : [];
      piece.view.refresh(state(lines, activeBoard === 'energy' && piece.item.kind === 'workBoard' || activeBoard === 'notice' && piece.item.kind === 'noticeBoard'));
    }
  };
  // Daylight follows the viewer's display clock, chosen in Settings like the language.
  const cafeHour = () => localHour(Date.now(), getTimezone());
  let clock = cafeHour(); const tick = window.setInterval(() => { clock = cafeHour(); }, 60_000);
  // A new clock in Settings changes the light and the lamps at once, not on the next minute.
  const unwatchClock = onTimezoneChange(() => { clock = cafeHour(); applyDaylight(hourNow()); render(); });
  let lit = -1; let light_: Daylight = daylight(clock);
  function applyDaylight(hour: number) {
    const d = appearanceDaylight(daylight(hour), appearance); lit = hour; light_ = d;
    lightingDirty = true;
    defaultLampOn = d.lamp > .5; placeLamps(); anchors();
    stage.glow.set(d.stage);
    const copy = wallBoardCopy(currentSnapshot, currentLocale, framedWidth() < 700);
    for (const piece of live.values()) piece.view.refresh?.({ locale: currentLocale, theme, mobile: framedWidth() < 700, board: { lines: piece.item.kind === 'workBoard' ? copy.performance : [], indicators: copy.indicators, residents: copy.residents, active: false }, tint: d.boards, notices: currentSnapshot?.houseNotices?.map(notice => notice.title) ?? [] });
    for (const sprite of [...sprites, baristaStand]) (sprite.userData.uniforms as StandeeUniforms).tint.value.set(d.tint);
    renderer.toneMappingExposure = d.exposure; renderer.shadowMap.needsUpdate = true;
  }
  const hourNow = () => { const pinned = Number(host.dataset.hour); return host.dataset.hour && Number.isFinite(pinned) ? pinned : clock; };
  let paused = false; let asleep = false; let agents: Agent[] = []; let disposed = false; let frame = 0; let renderRequested = false; const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let cadence = frameCadence(graphics.fps);
  // An unchanged scene is not drawn again: the loop keeps the residents' clocks moving, and the canvas keeps its last frame.
  const signature = frameSignature();
  const visibilityChanged = () => { cadence.reset(); if (!document.hidden) render(); };
  document.addEventListener('visibilitychange', visibilityChanged);
  // A room scrolled out of view or behind a closed tab stops its loop until it shows again.
  let offscreen = false;
  const sighting = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    const next = !entries.at(-1)?.isIntersecting; if (next === offscreen) return;
    offscreen = next; cadence.reset(); if (!offscreen) render();
  }) : null;
  sighting?.observe(host);
  const motions = new Map<string, Motion>();
  const actionClock = furnitureActionClock();
  const actionOwned = new Set<string>();
  const actorPositions = actorPositionWriter();
  const lastActionFrames = new Map<string, FurnitureActionFrame>();
  const actionExits = new Map<string, { previous: FurnitureActionFrame; operationId: string; since: number }>();
  let seen: Set<string> | null = null; const arrivals = new Map<string, number>(); const departing = new Map<string, number>();
  const FADE_MS = 500, EMOTE_MS = 2200;
  const modes = new Map<string, string>();
  let held: { id: string; point: Vec; lift: number; original: Motion } | null = null;
  const landed = new Map<string, number>(); const tapped = new Map<string, number>();
  const cues = new Map<string, { variant: TalkBubble['variant']; text: string; until: number }>();
  let cheering: Record<string, Cheer> = {};
  const cheerAt = (id: string, time: number) => { const cheer = cheering[id]; return cheer && time >= cheer.since && time - cheer.since < CELEBRATION_MS ? cheer : undefined; };
  function loadSet(value: StudioSet | null, built = true) {
    studioSet = value; const generation = ++setGeneration; setView?.dispose(); setView = undefined;
    if (value) void studioSetVisual(value).then(view => {
      if (disposed || generation !== setGeneration) { view.dispose(); return; }
      setView = view; group.add(view.root); renderer.shadowMap.needsUpdate = true; anchors(); render();
    }, () => { if (!disposed && generation === setGeneration) host.dataset.studioSetError = 'The studio set could not be loaded.'; });
    presenterPlace = null;
    if (built) { anchors(); render(); }
  }
  loadSet(studioSet, false);
  /** Where an editor works: the seat at the laptop's table (or in front of the laptop) and the table itself. */
  function editorDesk(agentId: string) {
    const key = furniture.find(item => item.id === editorDesks.find(desk => desk.agentId === agentId)?.furnitureId && !item.stowed);
    if (!key) return null;
    const table = (key.on ? furniture.find(item => item.id === key.on && !item.stowed) : undefined) ?? key;
    return { seat: seating(furniture).work.find(entry => entry.table.id === table.id)?.seat ?? { x: table.x, z: table.z - .9 }, table: { x: table.x, z: table.z } };
  }
  const raycaster = new THREE.Raycaster(); const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.3);
  function floorAt(clientX: number, clientY: number): Vec | null {
    const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3()); return hit ? { x: hit.x, z: hit.z } : null;
  }
  const surfacePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.08);
  function surfaceAt(clientX: number, clientY: number): Vec | null {
    const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.ray.intersectPlane(surfacePlane, new THREE.Vector3()); return hit ? { x: hit.x, z: hit.z } : null;
  }
  function pieceAt(clientX: number, clientY: number, rugs: boolean): string | null {
    const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
    const hits = raycaster.intersectObject(furnitureRoot, true).filter(hit => hit.object.userData.pieceId);
    const hit = hits.find(entry => live.get(entry.object.userData.pieceId)?.item.kind !== 'rug') ?? (rugs ? hits[0] : undefined);
    return hit ? hit.object.userData.pieceId as string : null;
  }
  let pointer: { x: number; y: number } | null = null; let hoverDirty = false;
  const hoverMove = (event: PointerEvent) => { if (event.pointerType === 'mouse') { pointer = { x: event.clientX, y: event.clientY }; hoverDirty = true; } };
  const hoverLeave = () => { pointer = null; hoverDirty = true; };
  renderer.domElement.addEventListener('pointermove', hoverMove); renderer.domElement.addEventListener('pointerleave', hoverLeave);
  let visitPrev: Snapshot | null = null; let visitWorld: VisitWorld = emptyVisits(); let talkKey = ''; let lastTalk: TalkBubble[] = [];
  let onTalk: (bubbles: TalkBubble[]) => void = () => {};
  let onCounter: (count: number) => void = () => {};
  function project(v: THREE.Vector3): Anchor { const p = v.clone().project(camera); return { x: (p.x + 1) * 50, y: (1 - p.y) * 50, scale: Math.min(1, host.clientWidth / 1100) }; }
  function pieceAnchor(id: string, allCorners = false): Anchor {
    const piece = live.get(id); if (!piece) return { x: 50, y: 30, width: 10, height: 10, scale: 1 };
    group.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(piece.node);
    const corners = (allCorners ? [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => new THREE.Vector3(x ? box.max.x : box.min.x, y ? box.max.y : box.min.y, z ? box.max.z : box.min.z)))) : [box.min, box.max, new THREE.Vector3(box.min.x, box.min.y, box.max.z), new THREE.Vector3(box.max.x, box.max.y, box.min.z)]).map(v => project(v));
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), scale: 1 };
  }
  function counterAnchor(): Anchor {
    const xs: number[] = [], ys: number[] = [];
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [.24, counter.height + .3]) { const p = project(new THREE.Vector3(counter.x + dx * (counter.halfX + .07), y, counter.z + dz * (counter.halfZ + .07))); xs.push(p.x); ys.push(p.y); }
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), scale: 1 };
  }
  function baristaAnchor(): Anchor {
    const v = baristaStand.position; const { width, top: rise } = baseSize(baristaStand);
    const head = project(new THREE.Vector3(v.x, v.y + rise, v.z)), foot = project(new THREE.Vector3(v.x, v.y, v.z));
    const left = project(new THREE.Vector3(v.x, v.y + 1, v.z - width / 2)), right = project(new THREE.Vector3(v.x, v.y + 1, v.z + width / 2));
    return { ...head, width: Math.max(4, Math.abs(right.x - left.x)), height: Math.abs(foot.y - head.y) };
  }
  function visibleBody(i: number) { return actionCards[i]?.card.visible ? actionCards[i].card : sprites[i]; }
  function place(i: number) { return visibleBody(i)?.visible ? visibleBody(i).position : new THREE.Vector3(stations[i]?.x ?? 0, .3, stations[i]?.z ?? 0); }
  let onPoints: (points: ResidentPoint[]) => void = () => {};
  function publishPoints() {
    const points: ResidentPoint[] = [];
    sprites.forEach((_, i) => {
      const agent = agents[i]; const body = visibleBody(i);
      if (!agent || !body.visible) return;
      const v = body.position;
      const { width, top } = baseSize(body);
      const half = width / 2;
      const head = project(new THREE.Vector3(v.x, v.y + top, v.z));
      const foot = project(new THREE.Vector3(v.x, v.y, v.z));
      const left = project(new THREE.Vector3(v.x - half, v.y + 1, v.z));
      const right = project(new THREE.Vector3(v.x + half, v.y + 1, v.z));
      points.push({ id: agent.id, headX: head.x, headY: head.y, footX: foot.x, footY: foot.y, width: Math.max(4, Math.abs(right.x - left.x)), mode: modes.get(agent.id) });
    });
    onPoints(points);
  }
  const itemWall = (item: FurnitureItem) => item.wall === 'left' ? { x: roomWalls.left.x, z: item.z } : { x: item.x, z: roomWalls.back.z };
  const props = () => {
    const at = (x: number, y: number, z: number) => { const p = project(new THREE.Vector3(x, y, z)); return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; };
    const { seats } = restSpots(furniture);
    return {
      seats: seats.map(v => at(v.x, .9, v.z)), desks: tables.map(v => at(v.x, 1, v.z)), floor: at(2.5, .3, 1.8), lamp: (() => { const lamp = furniture.find(item => item.kind === 'lamp'); return lamp ? at(itemWall(lamp).x, 3.3, itemWall(lamp).z) : at(-6.15, 3.3, 3.95); })(),
      plants: furniture.filter(item => item.kind === 'plant' && !item.stowed).map(p => at(p.x, .12 + .7 * (p.size ?? 1), p.z)),
      mugs: [] as number[][],
      pieces: Object.fromEntries(furniture.filter(item => !item.stowed).map(item => [item.id, at(item.x, .6, item.z)])),
    };
  };
  function anchors() {
    lamps.allocate(camera);
    host.dataset.props = JSON.stringify(props());
    onAnchors({
      stairs: stairLandings.anchors(project),
      lamps: [...live.values()].filter(piece => piece.view.lamp).map(piece => ({ id: piece.item.id, kind: piece.item.kind, on: lamps.isOn(piece.item.id), ...pieceAnchor(piece.item.id, true) })),
      speakers: furniture.filter(item => !item.stowed && isSpeaker(item.kind)).map(item => ({ id: item.id, ...pieceAnchor(item.id) })),
      residents: sprites.map((sprite, i) => { const v = place(i); const { width, top: rise } = baseSize(visibleBody(i) ?? sprite); const top = project(new THREE.Vector3(v.x, v.y + rise, v.z)); const bottom = project(new THREE.Vector3(v.x, v.y, v.z)); const left = project(new THREE.Vector3(v.x - width / 2, v.y + 1, v.z)); const right = project(new THREE.Vector3(v.x + width / 2, v.y + 1, v.z)); return { ...top, width: Math.max(4, Math.abs(right.x - left.x)), height: Math.abs(bottom.y - top.y) }; }),
      desks: sprites.map((_, i) => { const v = place(i); return project(new THREE.Vector3(v.x, v.y + .15, v.z)); }),
      energy: pieceAnchor(furniture.find(item => item.kind === 'workBoard')?.id ?? 'work-1'), notice: pieceAnchor(furniture.find(item => item.kind === 'noticeBoard')?.id ?? 'notice-1'), counter: counterAnchor(), barista: baristaAnchor(),
    });
  }
  /**
   * The talk-show camera: level with a seated host's face, a little above it, looking at the set from the front (+z).
   * Zoom 1 shows the host from the desk up with room around them; zoom 3 is a close-up.
   */
  function shootPresenter(shot: PresenterShot, width: number, height: number) {
    const place = presenterPlaceNow(); if (!place) return false;
    const hostAt = place.seat ? new THREE.Vector3(place.seat.x, SEATING_FLOOR_Y + place.seat.height + .62, place.seat.z) : new THREE.Vector3(place.stand.x, SEATING_FLOOR_Y + 1.15, place.stand.z);
    const desk = presenting?.spot === STUDIO_SET_SPOT && studioSet ? studioSetDesk(studioSet) : (piece => piece ? (piece.on ? furniture.find(item => item.id === piece.on) : piece) : undefined)(furniture.find(item => item.id === presenting?.spot));
    const deskAt = desk ? new THREE.Vector3(desk.x, SEATING_FLOOR_Y + .95, desk.z) : hostAt.clone();
    const target = hostAt.clone().lerp(deskAt, shot.toward), tall = 3 / Math.max(1, shot.zoom), half = roomFov * Math.PI / 360;
    camera.zoom = 1; camera.fov = roomFov; camera.aspect = width / height; camera.near = .3; camera.far = 400; camera.updateProjectionMatrix();
    const distance = tall / 2 / Math.tan(half), pitch = .12;
    camera.position.set(target.x, target.y + Math.sin(pitch) * distance, target.z + Math.cos(pitch) * distance); camera.lookAt(target); camera.updateMatrixWorld();
    host.dataset.camera = JSON.stringify({ position: camera.position.toArray(), projection: camera.projectionMatrix.toArray(), presenter: shot });
    return true;
  }
  function frameCamera() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    if (presenterShot && shootPresenter(presenterShot, width, height)) return;
    const size = framed(width, height), view = frameRoom(camera, size.width, size.height, cameraAngle); if (!view) return;
    const { halfW, halfH } = view, slack = 1 - 1 / cameraZoom;
    cameraPanX = Math.max(-halfW * slack, Math.min(halfW * slack, cameraPanX));
    cameraPanY = Math.max(-halfH * slack, Math.min(halfH * slack, cameraPanY));
    camera.zoom = cameraZoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const offset = right.multiplyScalar(cameraPanX).addScaledVector(up, cameraPanY);
    camera.position.add(offset); camera.lookAt(view.target.add(offset)); camera.updateMatrixWorld();
    host.dataset.camera = JSON.stringify({ position: camera.position.toArray(), projection: camera.projectionMatrix.toArray() });
  }
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    frameCamera();
    // A resized canvas starts blank, even when it ends at the size it had.
    renderer.setSize(width, height); signature.reset(); paintCurrentBoards(); anchors(); publishPoints(); render();
  }
  function zoomAt(factor: number, clientX: number, clientY: number) {
    const rect = host.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const size = framed(rect.width, rect.height), view = frameRoom(camera, size.width, size.height, cameraAngle); if (!view) return;
    const next = clampRoomZoom(cameraZoom * factor); if (next === cameraZoom) return;
    const { halfW, halfH } = view;
    const nx = (clientX - rect.left) / rect.width * 2 - 1, ny = 1 - (clientY - rect.top) / rect.height * 2;
    cameraPanX += nx * halfW * (1 / cameraZoom - 1 / next);
    cameraPanY += ny * halfH * (1 / cameraZoom - 1 / next);
    cameraZoom = next; frameCamera(); anchors(); publishPoints(); render();
  }
  function panBy(dx: number, dy: number) {
    const rect = host.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const size = framed(rect.width, rect.height), view = frameRoom(camera, size.width, size.height, cameraAngle); if (!view) return;
    cameraPanX -= dx * view.halfW * 2 / rect.width / cameraZoom;
    cameraPanY += dy * view.halfH * 2 / rect.height / cameraZoom;
    frameCamera(); anchors(); publishPoints(); render();
  }
  function zoomBy(factor: number) {
    const rect = host.getBoundingClientRect(); zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  function render() {
    if (disposed) return;
    renderRequested = true;
    if (!frame) frame = requestAnimationFrame(animate);
  }
  function drawNow() {
    if (disposed) return;
    renderRequested = false;
    prepareFrame();
    renderer.render(scene, camera);
  }
  /**
   * A requested or animated frame is drawn only when the scene reads differently from the last drawn one. A pending shadow
   * redraw is not part of the reading: the shadow map is made from the same scene, so it waits for the next real change.
   */
  function drawIfChanged() {
    renderRequested = false;
    prepareFrame();
    const canvas = renderer.domElement;
    if (signature.changed(scene, camera, [canvas.width, canvas.height, renderer.toneMappingExposure, scene.environmentIntensity, renderer.shadowMap.enabled ? renderer.shadowMap.type : -1])) renderer.render(scene, camera);
  }
  function prepareFrame() {
    if (lightingDirty) windows = placedWindows(live.values());
    if (lightingDirty) {
      light.update(light_, windows, theme.light, roomBrightness); lightingDirty = false;
      renderer.shadowMap.needsUpdate = true;
    }
    lamps.place();
    if (contacts.mesh.visible) contacts.update(live.values());
  }
  function animate(time: number) {
    frame = 0;
    if (disposed) return;
    if (document.hidden || offscreen) { cadence.reset(); return; }
    if (asleep) { if (renderRequested) drawIfChanged(); return; }
    frame = requestAnimationFrame(animate);
    const admission = cadence.advance(time);
    if (admission === 'skip') { if (renderRequested) drawIfChanged(); return; }
    if (admission === 'resume') {
      for (const motion of motions.values()) motion.time = time;
      if (baristaMotion) baristaMotion.time = time;
      for (const sprite of sprites) sprite.userData.time = time;
    }
    if (standHiddenForSeat) { baristaStand.visible = true; standHiddenForSeat = false; }
    const running = new Set((currentSnapshot?.tasks ?? []).filter(task => task.leaseUntil != null).map(task => task.toAgent));
    const view = cameraView(camera);
    orientCard(baristaStand, view, reduced.matches || paused ? 1 : .2);
    if (cleanupPending && !viewingCounter) { cleanupPending = false; baristaPerformance.cue('wipe', time); }
    landingMark.visible = Boolean(floorView?.landing);
    if (floorView?.landing) landingMark.position.set(floorView.landing.x, 0, floorView.landing.z);
    if (floorView) baristaStand.visible = floorView.floorId === activeFloor && Boolean(baristaStand.userData.layout);
    const hasOpenings=activeFloor===1&&stairways.length>0;light.openings(hasOpenings);ground.visible=!hasOpenings;stage.shadow.visible=!hasOpenings;contacts.mesh.visible=appearance==='polished'&&!hasOpenings;
    const hostSpot = presenterPlaceNow();
    const hostSits = Boolean(hostSpot?.seat && seatedLook());
    const wasOnStage = onStage; onStage = Boolean(hostSpot && baristaMotion?.arrivedAt !== undefined && baristaMotion.target.x === (hostSits ? hostSpot.seat! : hostSpot.stand).x && baristaMotion.target.z === (hostSits ? hostSpot.seat! : hostSpot.stand).z);
    if (onStage !== wasOnStage) dressBarista();
    // On stage the act comes from the script, looped for as long as its cue lasts; elsewhere the 1F service sequence plays.
    const baristaFrame = onStage && presenting ? { action: presenting.act, key: -1, ...baristaCell(presenting.act, (time - presenting.since) % baristaDuration(presenting.act), reduced.matches || paused) } : baristaPerformance.frame(time, reduced.matches || paused);
    if ((activeFloor === 0 || onStage) && baristaStand.userData.baristaSheet) paintFrame(baristaStand, baristaFrame.col, baristaFrame.row);
    host.dataset.baristaAction = `${baristaFrame.action}:${baristaFrame.col}`;
    if (serviceResult && !baristaPerformance.deliveryPending()) {
      const slot = counterSlots[serviceResult.slot]; if (slot.item === serviceResult.id) slot.cup.visible = true;
      serviceResult = null; handoff = null; serviceCup.visible = false;
    }
    const calmBarista = activeFloor !== 0 || !bar.surface.length || !baristaStand.visible || reduced.matches || paused || !baristaStand.userData.baristaSheet || !baristaStand.userData.baristaAnchored;
    if (calmBarista) {
      serviceCup.visible = false; handoff = null;
      if (serviceResult) { const slot = counterSlots[serviceResult.slot]; if (slot.item === serviceResult.id) slot.cup.visible = true; serviceResult = null; }
    } else if (baristaFrame.action === 'serve' && baristaFrame.col >= baristaHandoff.frame && baristaFrame.key !== releasedKey) {
      releasedKey = baristaFrame.key;
      const from = artPoint(baristaHandoff.base[0], baristaHandoff.base[1]);
      const surface = baristaDeliveryTarget(bar.surface, from, serviceResult?.slot);
      if (surface) {
        handoff = { key: baristaFrame.key, since: time, from, to: new THREE.Vector3(surface.x, surface.y, surface.z) };
        serviceCup.position.copy(from); serviceCup.visible = true;
      }
    }
    if (handoff && !calmBarista) {
      const progress = Math.min(1, (time - handoff.since) / baristaHandoff.fallMs);
      serviceCup.position.lerpVectors(handoff.from, handoff.to, progress * progress);
      if (progress === 1 && serviceResult) {
        const slot = counterSlots[serviceResult.slot]; if (slot.item === serviceResult.id) slot.cup.visible = true;
        serviceResult = null; handoff = null; serviceCup.visible = false;
      } else if (progress === 1 && time - handoff.since > 1600) { handoff = null; serviceCup.visible = false; }
    }
    host.dataset.baristaCup = serviceCup.visible ? 'released' : 'none';
    const spout = baristaFrame.action === 'brew' ? baristaPour.spout[baristaFrame.col] : null, filter = baristaFrame.action === 'brew' ? baristaPour.dripper[baristaFrame.col] : null;
    pour.visible = Boolean(!calmBarista && spout && filter);
    if (pour.visible && spout && filter) {
      const from = artPoint(spout[0], spout[1]), to = artPoint(filter[0], filter[1]), delta = to.clone().sub(from);
      pour.position.copy(from).add(to).multiplyScalar(.5); pour.scale.y = delta.length();
      pour.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    }
    const places: Record<string, { x: number; z: number }> = {};
    sprites.forEach((sprite, i) => { const agent = agents[i]; if (agent && sprite.visible) places[agent.id] = { x: sprite.position.x, z: sprite.position.z }; });
    const nav = actionNavigation();
    const ownerAction = currentSnapshot?.furnitureActions?.actors.find(state => state.actorId === ownerSenderId && actionClock.at(time) < state.expiresAt && projectFurnitureAction(state, actionClock.at(time)).floorId === activeFloor);
    const ownerLocked = Boolean(grid.visible || floorView?.positions[ownerSenderId] || ownerAction);
    // A performance outranks roaming, fixed floor positions and the barista's furniture actions; decorating outranks the performance.
    const ownerResult = hostSpot
      ? baristaPresenterStep(baristaMotion, { nav, time, spot: hostSits ? hostSpot.seat! : hostSpot.stand, view, ready: Boolean(baristaStand.userData.locomotion), paused: paused || reduced.matches })
      : baristaRoomStep(baristaMotion, {
        floorId: activeFloor, nav, time, start: floorView?.landing ?? { x: 0, z: 1.5 }, view,
        locked: ownerLocked, paused: paused || reduced.matches, ready: Boolean(baristaStand.userData.locomotion),
        others: Object.values(places), peers: [...motions].map(([id, motion]) => ({ id, position: motion.position, target: motion.target, moving: Math.hypot(motion.target.x - motion.position.x, motion.target.z - motion.position.z) > .05 })),
      });
    baristaMotion = ownerResult?.motion;
    if (ownerResult) {
      const cell = baristaRoomCell(ownerResult.facing, Math.floor(time / 125), view, ownerResult.speed > 0);
      if (baristaStand.userData.locomotion) paintFrame(baristaStand, cell.col, cell.row);
      baristaStand.position.set(ownerResult.motion.position.x, .3, ownerResult.motion.position.z);
      if (!onStage) host.dataset.baristaAction = `${ownerResult.action}:${cell.col}`;
      host.dataset.baristaMotion = JSON.stringify({ floorId: activeFloor, position: ownerResult.motion.position, target: ownerResult.motion.target, facing: ownerResult.facing, action: ownerResult.action, col: cell.col, row: cell.row, locked: ownerLocked, ready: Boolean(baristaStand.userData.locomotion) });
      anchors();
    } else delete host.dataset.baristaMotion;
    const seatedNow = onStage && hostSits ? hostSpot?.seat ?? null : null;
    baristaSeat.visible = Boolean(seatedNow) && baristaStand.visible;
    if (seatedNow && baristaSeat.visible) {
      baristaSeat.position.set(seatedNow.x, SEATING_FLOOR_Y + seatedNow.height, seatedNow.z); orientCard(baristaSeat, view, 1);
      baristaStand.visible = false; standHiddenForSeat = true;
    }
    if (presenting) host.dataset.presenter = JSON.stringify({ spot: presenting.spot, act: presenting.act, onStage, seated: Boolean(seatedNow), place: hostSpot });
    else delete host.dataset.presenter;

    const widths: Record<string, number> = {};
    sprites.forEach((sprite, i) => { const agent = agents[i]; if (agent && sprite.visible) widths[agent.id] = baseSize(sprite).width; });
    const still = reduced.matches || paused;
    const stopped = new Set(agents.filter(agent => cheerHolds({ agent, pose: currentSnapshot ? residentEnergy(currentSnapshot, agent).pose : 'unknown', busy: running.has(agent.id), reduced: still, cheer: cheerAt(agent.id, time) })).map(agent => agent.id));
    const ticked = tickVisits(visitWorld, places, time, still, view, nav, widths, stopped);
    visitWorld = ticked.world;
    const spots = restSpots(furniture); const seats = [...spots.seats, openSpot(spots.rest, nav)];
    const lingering = standingPois(pois);
    const resting = agents.filter((agent, i) => sprites[i]?.userData.seated && agent.presence !== 'left' && (agent.presence === 'unavailable' || agent.presence === 'silent' || agent.reachable === false || (currentSnapshot && residentEnergy(currentSnapshot, agent).pose === 'rest')));
    const sitting = new Set(agents.flatMap(agent => { const motion = motions.get(agent.id); return motion?.slot && motion.mode !== 'dozing' && motion.mode !== 'sleeping' ? [motion.slot] : []; }));
    const seatOrder = seats.map((_, k) => k).sort((a, b) => Number(sitting.has(`seat:${a}`)) - Number(sitting.has(`seat:${b}`)));
    const actionTime = actionClock.at(time);
    const actionFrames = new Map<string, FurnitureActionFrame>();
    for (const state of currentSnapshot?.furnitureActions?.actors ?? []) {
      const index = agents.findIndex(agent => agent.id === state.actorId);
      if (index < 0 || agents[index].presence === 'left') continue;
      if (state.seating && !furniture.some(item => matchingSeating(item, state, actionTime))) continue;
      actionCards[index].card.userData.actionFailure = undefined;
      const pack = packForAction(agents[index].appearance, state.action);
      const path = pack ? `/media/${pack.key}` : undefined;
      const texture = path && !failed.has(path) ? avatarTexture(path) : undefined;
      let accepted = furnitureActionFrame(state, actionTime, pack, Boolean(texture?.image));
      if (!accepted) continue;
      const previous = lastActionFrames.get(state.actorId);
      if (!state.seating && (state.action === 'rise' || state.action === 'cancel') && previous?.clip?.seated && previous.clip.pack.id === pack?.id && previous.state.operationId !== state.operationId && !actionExits.has(state.actorId)) {
        actionExits.set(state.actorId, { previous, operationId: state.operationId, since: time });
      }
      const exit = actionExits.get(state.actorId);
      if (exit && exit.operationId === state.operationId && !still) accepted = furnitureActionExit(exit.previous, accepted, time - exit.since);
      if (exit && (time - exit.since >= 650 || exit.operationId !== state.operationId)) actionExits.delete(state.actorId);
      if (accepted.clip && texture) {
        if (actionCards[index].show(accepted, texture, light_.tint)) group.add(actionCards[index].card);
        else accepted = furnitureActionFrame(state, actionTime, pack, false)!;
      }
      actionFrames.set(state.actorId, accepted);
      lastActionFrames.set(state.actorId, accepted);
    }
    for (const id of actionOwned) if (!actionFrames.has(id)) {
      const previous = motions.get(id);
      if (previous) {
        const position = nearestFree(nav, previous.position) ?? previous.position;
        motions.set(id, { ...previous, position, target: position, path: [], time, pauseUntil: 0, hold: undefined, slot: undefined });
      }
      actionOwned.delete(id); lastActionFrames.delete(id); actionExits.delete(id);
    }
    const before = new Map(motions);
    const peers = [...(baristaMotion ? [{ id: ownerSenderId, position: baristaMotion.position, target: baristaMotion.target, moving: Math.hypot(baristaMotion.target.x - baristaMotion.position.x, baristaMotion.target.z - baristaMotion.position.z) > .05 }] : []), ...agents.flatMap(agent => { const motion = before.get(agent.id); return motion && agent.id !== held?.id ? [{ id: agent.id, position: motion.position, target: motion.target, moving: Math.hypot(motion.target.x - motion.position.x, motion.target.z - motion.position.z) > .05 && !motion.hold && !stopped.has(agent.id) }] : []; })];
    const steps = sprites.map((sprite, i) => {
      const agent = agents[i]; if (!agent) return null;
      const point = floorView?.positions[agent.id];
      if (point) {
        const motion: Motion = { position: { ...point }, target: { ...point }, path: [], facing: 'S', pauseUntil: 0, mode: 'wander', time };
        motions.set(agent.id, motion); arrivals.delete(agent.id); modes.set(agent.id, 'floor-position');
        const result: StepResult = { motion, target: motion.target, speed: 0, facing: motion.facing, action: 'idle', mode: motion.mode };
        return { agent, order: undefined, result, fixed: true };
      }
      const accepted = actionFrames.get(agent.id);
      if (accepted) {
        actionOwned.add(agent.id); arrivals.delete(agent.id);
        if (held?.id === agent.id) { held = null; delete host.dataset.held; }
        const result = accepted.result; result.motion.time = time;
        motions.set(agent.id, result.motion); modes.set(agent.id, `furniture:${accepted.state.action}:${accepted.clip ? 'art' : 'standing'}`);
        return { agent, order: undefined, result, fixed: true };
      }
      const pose = currentSnapshot ? residentEnergy(currentSnapshot, agent).pose : 'unknown';
      const seated = Boolean(sprite.userData.seated);
      const desk = editorDesk(agent.id);
      // An editor takes the laptop's chair itself, so they sit at it rather than beside it, clear of the laptop the barista taps.
      const stand = desk ? { ...desk.seat } : workSpot({ x: stations[i].x, z: stations[i].z }, tables[i], seated, nav);
      const order = ticked.orders[agent.id];
      const others = agents.flatMap(other => { const motion = other.id === agent.id ? undefined : motions.get(other.id); return motion ? [motion.position, motion.target] : []; });
      if (held?.id === agent.id) {
        const was = motions.get(agent.id) ?? { facing: 'S' as const, pauseUntil: 0, mode: 'wander' as const, position: held.point, target: held.point, time };
        const motion: Motion = { ...was, position: { ...held.point }, target: { ...held.point }, path: [], time }; delete motion.hold;
        motions.set(agent.id, motion); modes.set(agent.id, 'held');
        const result: StepResult = { motion, target: motion.target, speed: 0, facing: motion.facing, action: 'idle', mode: motion.mode };
        return { agent, order: undefined, result, fixed: true };
      }
      if (arrivals.get(agent.id) === -1) { arrivals.set(agent.id, time); motions.set(agent.id, { position: { ...doorway(furniture).outside }, target: { ...doorway(furniture).outside }, path: [], facing: 'E', pauseUntil: 0, mode: 'wander', time }); }
      const seat = seated ? seatOrder[Math.min(seats.length - 1, Math.max(0, resting.indexOf(agent)))] : seats.length - 1;
      const taken = agents.flatMap(other => { const slot = other.id === agent.id ? undefined : motions.get(other.id)?.slot; return slot ? [slot] : []; });
      const result = step(motions.get(agent.id), { agent, pose, position: stand, time, station: stand, sofa: seats[seat], sofaSlot: `seat:${seat}`, busy: Boolean(desk) || running.has(agent.id), reduced: still, view, visit: order, nav, door: doorway(furniture).outside, peers: peers.filter(peer => peer.id !== agent.id), others, pois: seated ? pois : lingering, taken, cheer: cheerAt(agent.id, time) });
      motions.set(agent.id, result.motion); modes.set(agent.id, result.mode);
      if (result.gone && !departing.get(agent.id)) departing.set(agent.id, time);
      return { agent, order, result, fixed: Boolean(order) || Boolean(result.activity) || Boolean(cheerAt(agent.id, time)) || (result.mode !== 'wander' && result.mode !== 'tired') };
    });
    const trajectories = steps.flatMap(entry => {
      if (!entry || floorView?.positions[entry.agent.id] || entry.agent.id === held?.id || actionFrames.has(entry.agent.id)) return [];
      const from = before.get(entry.agent.id)?.position ?? entry.result.motion.position, position = entry.result.motion.position;
      return [{ id: entry.agent.id, from, position, fixed: Math.hypot(position.x - from.x, position.z - from.z) < 1e-8 }];
    });
    const clipped = still ? {} : resolveCrowd(nav, trajectories);
    for (const entry of steps) {
      const point = entry && clipped[entry.agent.id]; if (!entry || !point || Math.hypot(point.x - entry.result.motion.position.x, point.z - entry.result.motion.position.z) < 1e-6) continue;
      entry.result.motion = { ...entry.result.motion, position: point, path: [], navRevision: undefined };
      motions.set(entry.agent.id, entry.result.motion);
    }
    const said = talkBubbles(ticked.orders); const speaking = new Set(said.map(bubble => bubble.agentId));
    for (const [id, cue] of cues) if (cue.until <= time) cues.delete(id);
    const reacting = [...cues].flatMap(([agentId, cue]) => speaking.has(agentId) ? [] : [{ agentId, variant: cue.variant, text: cue.text }]); for (const cue of reacting) speaking.add(cue.agentId);
    const emotes = steps.flatMap(entry => entry?.result.activity && !speaking.has(entry.agent.id) && time - (entry.result.since ?? 0) < EMOTE_MS ? [{ agentId: entry.agent.id, variant: 'emote' as const, text: entry.result.activity }] : []);
    for (const bubble of emotes) speaking.add(bubble.agentId);
    const marks = steps.flatMap(entry => { const mark = entry && !actionFrames.has(entry.agent.id) && !speaking.has(entry.agent.id) ? actionMark(entry.result.action) : undefined; return entry && mark ? [{ agentId: entry.agent.id, variant: 'emote' as const, text: mark }] : []; });
    const furnitureMarks = [...actionFrames.values()].flatMap(entry => entry.mark ? [{ agentId: entry.state.actorId, variant: 'emote' as const, text: entry.mark }] : []);
    const bubbles = [...said, ...reacting, ...emotes, ...marks, ...furnitureMarks];
    const key = bubbles.map(bubble => `${bubble.agentId}:${bubble.variant}:${bubble.text}`).join('|');
    if (key !== talkKey) { talkKey = key; lastTalk = bubbles; onTalk(bubbles); }
    const bodies_ = steps.flatMap(entry => entry ? [`${entry.agent.id}:${modes.get(entry.agent.id) ?? entry.result.mode}`] : []).join(' '); if (host.dataset.bodies !== bodies_) host.dataset.bodies = bodies_;
    const bodies = steps.flatMap(entry => entry ? [{ id: entry.agent.id, position: entry.result.motion.position, fixed: entry.fixed }] : []);
    const spread = still ? {} : separate(nav, [...bodies, ...(baristaMotion ? [{ id: ownerSenderId, position: baristaMotion.position, fixed: true }] : [])]);
    for (const entry of steps) {
      const next = entry && !entry.fixed ? spread[entry.agent.id] : undefined; const motion = entry?.result.motion;
      if (!entry || !next || !motion || (next.x === motion.position.x && next.z === motion.position.z)) continue;
      entry.result = { ...entry.result, motion: { ...motion, position: next, ...(entry.result.speed ? {} : { target: { ...next }, path: [] }) } };
      motions.set(entry.agent.id, entry.result.motion);
    }
    actorPositions.record(currentSnapshot?.house, steps.flatMap((entry, index) => entry && entry.agent.presence !== 'left' && (sprites[index].userData.bodyVisible || actionCards[index].card.visible) ? [[entry.agent.id, entry.result.motion.position] as const] : []));
    sprites.forEach((sprite, i) => {
      const entry = steps[i]; if (!entry) return;
      const accepted = actionFrames.get(entry.agent.id);
      const actionCard = actionCards[i];
      if (!accepted?.clip) actionCard.hide();
      sprite.visible = Boolean(sprite.userData.bodyVisible) && !actionCard.card.visible;
      const { order, result } = entry; const calm = reduced.matches || paused;
      const dt = Math.min(.1, (time - (sprite.userData.time ?? time)) / 1000); sprite.userData.time = time;
      const elapsed = time - (order?.since ?? time);
      const walking = result.speed > 0 && !calm;
      sprite.userData.gait = walking ? (sprite.userData.gait ?? 0) + dt * Math.PI * 2.2 * result.speed : 0;
      const lifted = held?.id === entry.agent.id; if (lifted && held) held.lift += (LIFT - held.lift) * Math.min(1, dt * 12);
      const down = landed.get(entry.agent.id); if (down !== undefined && time - down >= LAND_MS) landed.delete(entry.agent.id);
      const tap = tapped.get(entry.agent.id); if (tap !== undefined && time - tap >= TAP_MS) tapped.delete(entry.agent.id);
      const last: Vec = sprite.userData.last ?? result.motion.position; sprite.userData.last = { ...result.motion.position };
      const dx = result.motion.position.x - last.x, dz = result.motion.position.z - last.z;
      const across = (dx * view.z - dz * view.x) / (Math.hypot(view.x, view.z) || 1) / (Math.hypot(dx, dz) || 1);
      const cheer = cheerAt(entry.agent.id, time);
      const pose = actionPose({ action: result.action, time, seed: i * 1.7, calm, walking, gait: sprite.userData.gait, across, mail: result.hop ? elapsed : undefined, landed: down === undefined ? undefined : time - down, tapped: tap === undefined ? undefined : time - tap, raised: lifted && held ? held.lift : 0, cheer: cheer && celebrationBeats(cheer.event.kind, time - cheer.since, calm).jump });
      const { hop, stretch } = pose;
      sprite.lean = pose.dangle ? pose.lean : calm ? 0 : sprite.lean + (pose.lean - sprite.lean) * Math.min(1, dt * 8);
      const base = baseSize(sprite); sprite.scale.set(base.width * (1 - stretch * .6), base.height * (1 + stretch), 1);
      orientCard(sprite, view, calm ? 1 : Math.min(1, dt * 12)); const facing = !sprite.userData.sheet && cardFacing(result.facing, view) === 'W' ? -1 : 1;
      sprite.flip = calm ? facing : sprite.flip + Math.max(-dt * 16, Math.min(dt * 16, facing - sprite.flip));
      sprite.position.set(result.motion.position.x, .3 + hop, result.motion.position.z);
      if (sprite.userData.sheet && sprite.material.map && sprite.userData.layout) {
        const cell = sprite.userData.baristaGuest && sprite.userData.sheet === 'four' ? baristaRoomCell(result.facing, Math.floor(time / 125), view, result.speed > 0 && !calm) : sheetCell(sprite.userData.sheet, result.facing, Math.floor(time / 125), view, result.speed > 0 && !calm);
        paintFrame(sprite, cell.col, cell.row);
      }
      shadows[i].position.set(sprite.position.x, .273, sprite.position.z); shadows[i].scale.setScalar(Math.max(.35, 1 - hop * 1.1));
      bases[i].position.set(sprite.position.x, .28 + hop, sprite.position.z); bases[i].visible = sprite.visible;
      const uniforms = sprite.userData.uniforms as StandeeUniforms;
      if (!calm) uniforms.sheen.value = time / 9000 + i * .37;
      const dimTo = result.mode === 'dozing' ? 1 : 0; uniforms.dim.value = calm ? dimTo : uniforms.dim.value + (dimTo - uniforms.dim.value) * Math.min(1, dt * 2.5);
      const came = arrivals.get(entry.agent.id), went = departing.get(entry.agent.id);
      const fade = Math.min(came && came > 0 ? Math.min(1, (time - came) / FADE_MS) : 1, went ? Math.max(0, 1 - (time - went) / FADE_MS) : 1);
      if (came && came > 0 && fade >= 1) arrivals.delete(entry.agent.id);
      sprite.material.opacity = fade; sprite.material.transparent = fade < 1; bases[i].visible = sprite.visible && fade > .5;
      if (actionCard.card.visible) shadows[i].visible = true;
      (shadows[i].material as THREE.MeshBasicMaterial).opacity = .52 * Math.max(.25, 1 - hop * 1.2) * fade;
    });
    host.dataset.furnitureActions = JSON.stringify([...actionFrames.values()].map(accepted => {
      const index = agents.findIndex(agent => agent.id === accepted.state.actorId);
      const card = actionCards[index].card;
      card.updateMatrixWorld(true);
      const projectedBounds = (left: number, top: number, right: number, bottom: number) => [
        new THREE.Vector3(left - .5, .5 - top, 0), new THREE.Vector3(right - .5, .5 - top, 0),
        new THREE.Vector3(right - .5, .5 - bottom, 0), new THREE.Vector3(left - .5, .5 - bottom, 0),
      ].map(point => point.applyMatrix4(card.matrixWorld).project(camera).toArray());
      const opaque = card.userData.actionOpaque as { left: number; top: number; right: number; bottom: number } | null | undefined;
      const alphaBounds = opaque && projectedBounds(opaque.left, opaque.top, opaque.right, opaque.bottom);
      return { actorId: accepted.state.actorId, operationId: accepted.state.operationId, action: accepted.state.action,
        phase: projectFurnitureAction(accepted.state, actionTime).phase, seatingPhase: projectFurnitureAction(accepted.state, actionTime).seatingPhase,
        rendered: card.visible ? 'clip' : 'standing', facing: accepted.result.facing, mark: accepted.mark,
        fallbackReason: accepted.state.fallbackReason ?? card.userData.actionFailure, opaque: card.userData.actionOpaque,
        row: accepted.clip?.row, col: accepted.clip?.col, position: card.visible ? card.position.toArray() : sprites[index].position.toArray(),
        yaw: card.yaw, flip: card.flip, scale: card.scale.toArray(), pivot: card.center.toArray(),
        depthTest: card.material.depthTest, depthWrite: card.material.depthWrite, renderOrder: card.renderOrder,
        bounds: card.visible ? projectedBounds(0, 0, 1, 1) : undefined, alphaBounds: card.visible ? alphaBounds : undefined };
    }));
    const gone = [...departing].filter(([, at]) => at && time - at >= FADE_MS).map(([id]) => id);
    if (gone.length) { for (const id of gone) { departing.delete(id); motions.delete(id); modes.delete(id); } applySnapshot(currentSnapshot, currentScenery, currentLocale); }
    if (time - counterChecked > 400 || counterSlots.some(slot => slot.slot.visible && slot.slot.scale.x < 1)) layCounter(time);
    if (Math.abs(hourNow() - lit) > 1 / 120) applyDaylight(hourNow());
    const calmRoom = reduced.matches || paused || graphics.calmDecor;
    let seatingPoseChanged = false;
    for (const piece of live.values()) {
      const since = time - piece.poked;
      if (piece.view.react) piece.view.react(since < 0 ? 1e9 : since, calmRoom);
      if (catalog[piece.item.kind].mount === 'wall') continue;
      const settled = calmRoom || since > 2000; const node = piece.node;
      if (catalog[piece.item.kind].mount === 'floor' && moving?.id !== piece.item.id) {
        const offset = seatingFurnitureOffset(piece.item, currentSnapshot?.furnitureActions?.actors ?? [], actionTime);
        const x = piece.item.x + (offset?.x ?? 0), z = piece.item.z + (offset?.z ?? 0);
        if (node.position.x !== x || node.position.z !== z) { node.position.x = x; node.position.z = z; seatingPoseChanged = true; }
      }
      const plant = piece.item.kind === 'plant' || piece.item.kind === 'potPlant';
      const sway = settled || !plant ? 0 : Math.sin(since / 110) * .14 * Math.exp(-since / 500);
      node.rotation.set(sway * .4, node.userData.baseRotationY ?? -piece.item.turn * Math.PI / 2, sway);
      const hops = interactionsOf(piece.item, 'poke')[0]?.reaction === 'bounce';
      const hop = settled || !hops ? 0 : Math.abs(Math.sin(since / 120)) * .12 * Math.exp(-since / 300);
      node.position.y = (node.userData.baseY ?? 0) + (moving?.id === piece.item.id ? .15 : 0) + hop;
    }
    if (seatingPoseChanged) publishFurniture();
    ambience.update(roomLayout.stations.map((_, i) => Boolean(agents[i] && (agents[i].state === 'working' || running.has(agents[i].id)))), time, reduced.matches || paused);
    if (hoverDirty) {
      hoverDirty = false; const next = pointer && !held && !moving ? pieceAt(pointer.x, pointer.y, grid.visible) : null;
      if (next !== hovered) { hovered = next; placeGlow(); if (hovered) host.dataset.hovered = ''; else delete host.dataset.hovered; }
    }
    glow.tick(time, calmRoom);
    publishPoints();
    drawIfChanged();
  }
  function applyGraphics(next: GraphicsProfile) {
    const shadowsChanged = next.shadows !== graphics.shadows; graphics = next; host.dataset.graphics = next.tier;
    renderer.setPixelRatio(Math.min(devicePixelRatio, next.maxPixelRatio));
    cadence = frameCadence(next.fps);
    if (shadowsChanged) {
      renderer.shadowMap.enabled = next.shadows !== 'off'; renderer.shadowMap.type = next.shadows === 'simple' ? THREE.BasicShadowMap : THREE.PCFShadowMap;
      light.shadowDetail(next.shadows === 'simple'); renderer.shadowMap.needsUpdate = true;
      // Shadow sampling is compiled into each shader, so every material builds again with the new setting.
      scene.traverse(node => { const material = (node as THREE.Mesh).material; for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true; });
    }
    resize();
  }
  applyDaylight(hourNow());
  layFurniture(options.furniture ?? defaultFurniture);
  const observer = new ResizeObserver(() => resize()); observer.observe(host); resize();
  options.debug?.({ scene, camera, renderer, render, paintFrame, actor: baristaStand, residents: sprites });
  onReady();
  function applySnapshot(snapshot: Snapshot | null, scenery: SceneryId, locale: Locale) {
      if (snapshot && visitPrev) for (const visit of newVisits(visitPrev, snapshot)) visitWorld = acceptVisit(visitWorld, visit, performance.now());
      visitPrev = snapshot;
      if (snapshot?.house !== currentSnapshot?.house) actorPositions.clear();
      actionClock.sync(snapshot, performance.now());
      lamps.setScope(options.persistLights === false ? undefined : snapshot?.house); placeLamps();
      currentSnapshot = snapshot; currentLocale = locale; currentScenery = scenery; paintCurrentBoards();
      if (snapshot) {
        if (seen && snapshot.agents.some(a => a.presence !== 'left' && !seen!.has(a.id))) baristaPerformance.cue('greet', performance.now());
        if (seen && !reduced.matches) for (const a of snapshot.agents) {
          if (a.presence === 'left' && seen.has(a.id) && !departing.has(a.id)) departing.set(a.id, 0);
          if (a.presence !== 'left' && !seen.has(a.id) && !motions.has(a.id)) arrivals.set(a.id, -1);
        }
        for (const id of departing.keys()) if (!snapshot.agents.some(a => a.id === id && a.presence === 'left')) departing.delete(id);
        seen = new Set(snapshot.agents.filter(a => a.presence !== 'left').map(a => a.id));
      }
      agents = snapshot?.agents.filter(a => a.presence !== 'left' || departing.has(a.id)) ?? [];
      for(const location of snapshot?.furnitureActions?.locations??[]){if(location.floorId!==activeFloor||motions.has(location.actorId))continue;const position=nearestFree(actionNavigation(),location.position)??location.position;motions.set(location.actorId,{position,target:position,path:[],facing:'S',pauseUntil:0,mode:'wander',time:performance.now()});arrivals.delete(location.actorId);}

      while (sprites.length < agents.length) { addResident(sprites.length); (sprites.at(-1)!.userData.uniforms as StandeeUniforms).tint.value.set(light_.tint); }
      if (themeFor(scenery) !== theme) { theme = themeFor(scenery); surfaces.paint(theme); paintCurrentBoards(); lit = -1; }
      sprites.forEach((sprite, i) => {
        const agent = agents[i];
        const visitor = agent && (snapshot?.activeVisitors ?? snapshot?.visitors)?.find(entry => `visitor:${entry.id}` === agent.id);
        sprite.userData.baristaGuest = visitor?.kind === 'barista';
        const looks = agent && visitor?.kind === 'barista' ? baristaGuestLooks(agent.character, visitor.baristaLook) : agent ? characterLooks(agent) : [];
        const look = agent ? looks.find(item => !failed.has(item.src)) : undefined;
        const source = look ? avatarTexture(look.src) : null;
        sprite.visible = Boolean(agent && source?.image); sprite.userData.bodyVisible = sprite.visible; shadows[i].visible = sprite.visible;
        if (sprite.userData.actorId !== agent?.id) actionCards[i].hide();
        sprite.userData.actorId = agent?.id;
        if (actionCards[i].card.visible) sprite.visible = false;
        for (const pack of [agent?.appearance?.actionPack, seatedPackOf(agent?.appearance)]) if (pack) {
          const path = `/media/${pack.key}`;
          if (!failed.has(path)) avatarTexture(path);
        }
        if (agent && look && source?.image) {
          const image = source.image as HTMLImageElement;
          const key = `${look.kind}:${look.src}`;
          if (sprite.userData.character !== key) {
            const format = look.kind === 'sheet' ? sheetFormatOf(image.width, image.height) ?? undefined : undefined; sprite.userData.sheet = format;
            if (format) { const cell = sheetCell(format, 'S', 0, undefined, false); wear(sprite, source, measured(look.src, image, format), cell.col, cell.row); }
            else wear(sprite, source, measured(look.src, image), 0, 0);
            sprite.userData.character = key;
          }
        }
        sprite.userData.seated = canSit(look, sprite.userData.sheet);
        if (!agent || !sprite.visible) return;
        sprite.material.opacity = 1;
      }); dressBarista(); renderer.shadowMap.needsUpdate = true; anchors(); publishPoints(); render();
  }
  return {
    stairs(items, floor) { host.dataset.floorId=String(floor);stairways=[...items];activeFloor=floor;dressBarista();stairLandings.update(items, floor);openFloor.update(items);closedFloor.visible=floor===0||!items.length;openFloor.root.visible=!closedFloor.visible; anchors(); renderer.shadowMap.needsUpdate = true; render(); },
    pickStair(x,y) {
      const rect = host.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
      return stairLandings.pick(ray) ?? (() => { const id=pieceAt(x,y,true);return id && furniture.some(item=>item.id===id&&isStair(item)) ? id : null; })();
    },
    floorView(value) { floorView = value; host.dataset.floorId = String(value?.floorId ?? activeFloor); },
    update: applySnapshot,
    finish(choice) { surfaces.choose(choice, theme); renderer.shadowMap.needsUpdate = true; render(); },
    brightness(value) { const next = boundedBrightness(value); if (next === roomBrightness) return; roomBrightness = next; host.dataset.brightness = String(next); lightingDirty = true; render(); },
    appearance(mode) {
      if (appearance === mode) return;
      appearance = mode; host.dataset.appearance = mode;
      contacts.mesh.visible = mode === 'polished';
      for (const piece of live.values()) piece.view.appearance(mode);
      applyDaylight(hourNow()); render();
    },
    view(angle) { cameraAngle = clampRoomAngle(angle); frameCamera(); anchors(); publishPoints(); render(); },
    zoomAt,
    zoomBy,
    panBy,
    resetView() { cameraAngle = 0; cameraZoom = 1; cameraPanX = 0; cameraPanY = 0; frameCamera(); anchors(); publishPoints(); render(); },
    cameraView() { return { angle: cameraAngle, zoom: cameraZoom, panX: cameraPanX, panY: cameraPanY }; },
    restoreView(view) { cameraAngle = clampRoomAngle(view.angle); cameraZoom = clampRoomZoom(view.zoom); cameraPanX = view.panX; cameraPanY = view.panY; frameCamera(); anchors(); publishPoints(); render(); },
    board(next) { activeBoard = next; paintCurrentBoards(); render(); },
    open(listener) { onOpen = listener; },
    arrange(active) { grid.visible = active; host.dataset.grid = active ? '0.25' : ''; render(); },
    barista(character, appearance) { if (character === baristaLook && JSON.stringify(appearance ?? null) === JSON.stringify(baristaOwn ?? null)) return; baristaLook = character; baristaOwn = appearance; dressBarista(); anchors(); render(); },
    baristaAction(action) { baristaPerformance.cue(action, performance.now()); },
    studioSet(value) { if (JSON.stringify(value) !== JSON.stringify(studioSet)) loadSet(value); },
    pickSet(clientX, clientY) {
      if (!setView || grid.visible) return false;
      const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return false;
      raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
      const set = raycaster.intersectObject(setView.root, true)[0]?.distance ?? Infinity, piece = raycaster.intersectObject(furnitureRoot, true)[0]?.distance ?? Infinity;
      return set < piece;
    },
    editors(desks) { editorDesks = desks; },
    shoot(shot) { presenterShot = shot; frameCamera(); anchors(); render(); },
    present(spot) {
      if ((presenting?.spot ?? null) === spot) return;
      presenting = spot ? { spot, act: 'idle', since: performance.now() } : null;
      if (!spot && onStage) { onStage = false; baristaSeat.visible = false; dressBarista(); }
      render();
    },
    perform(act, elapsed) {
      if (!presenting) return;
      const now = performance.now();
      if (act !== presenting.act || Math.abs((now - presenting.since) / 1000 - elapsed) > .25) presenting = { ...presenting, act, since: now - elapsed * 1000 };
    },
    furniture(items, coveredIds = []) {
      const nextCovered = new Set(coveredIds);
      const changedCovers = nextCovered.size !== coveredFurniture.size || [...nextCovered].some(id => !coveredFurniture.has(id));
      coveredFurniture = nextCovered;
      if (JSON.stringify(items) !== layoutKey) layFurniture(items);
      else if (changedCovers) for (const piece of live.values()) void piece.view.set(furnitureVisualRequest(piece.item, piece.key, coveredFurniture.has(piece.item.id)));
      publishFurniture(); anchors(); render();
    },
    placementFurniture(items) { placementFurniture = items; },
    retryFurniture() { for (const piece of live.values()) void piece.view.retry(); },
    select(id) { selected = id; placeGlow(); render(); },
    pickPiece(clientX, clientY) { return pieceAt(clientX, clientY, true); },
    dragPiece(id, clientX, clientY) {
      const item = furniture.find(entry => entry.id === id); const piece = live.get(id);
      const point = item && catalog[item.kind].mount === 'surface' ? surfaceAt(clientX, clientY) : floorAt(clientX, clientY);
      if (!item || !point || !piece) return null;
      if (moving?.id !== id) {
        moving = { id, dx: item.x - point.x, dz: item.z - point.z, x: item.x, z: item.z, ...placement(item) };
        return { x: item.x, z: item.z, ok: moving.ok, reason: moving.reason };
      }
      const mount = catalog[item.kind].mount;
      if (mount === 'surface') {
        const x = point.x + moving.dx, z = point.z + moving.dz;
        const candidate = moveItem(furniture, id, x, z)?.find(item => item.id === id);
        moving = { ...moving, x, z, ok: Boolean(candidate), reason: undefined };
        if (candidate) placePiece(candidate, piece.node); else piece.node.position.set(x, .15 + (piece.node.userData.baseY ?? 0), z);
        placeGlow(); render(); return { x, z, ok: moving.ok };
      }
      const inside = clampInRoom(item, point.x + moving.dx, point.z + moving.dz);
      const wall = mount === 'wall';
      const x = wall && item.wall === 'left' ? 0 : Math.round(inside.x * 4) / 4;
      const z = wall && item.wall !== 'left' ? 0 : Math.round(inside.z * 4) / 4;
      moving = { ...moving, x, z, ...placement({ ...item, x, z }) };
      if (isStair(item)) { const preview=stairways.map(stair=>stair.id===id?{...stair,x,z}:stair); stairLandings.update(preview,activeFloor);openFloor.update(preview); }
      placePiece({ ...item, x, z }, piece.node); placeRiders({ ...item, x, z }); placeGlow(); render();
      return { x, z, ok: moving.ok, reason: moving.reason };
    },
    endDrag() {
      const piece = moving && live.get(moving.id); if (piece) { placePiece(piece.item, piece.node); placeRiders(piece.item); }
      stairLandings.update(stairways,activeFloor);openFloor.update(stairways);
      moving = null; placeGlow(); render();
    },
    motion(next) { paused = next; },
    graphics(next) { if (!disposed && next !== graphics) applyGraphics(next); },
    sleep(next) { if (disposed || next === asleep) return; asleep = next; cadence.reset(); cancelAnimationFrame(frame); frame = 0; if (!next || renderRequested) frame = requestAnimationFrame(animate); },
    follow(listener) { onPoints = listener; publishPoints(); },
    talk(listener) { onTalk = listener; if (talkKey) onTalk(lastTalk); },
    counterViewing(open) { viewingCounter = open; placeGlow(); render(); },
    glowTarget(target, reason, on) { if (on) targetLit[target].add(reason); else targetLit[target].delete(reason); placeGlow(); render(); },
    counter(listener) { onCounter = listener; onCounter(Number(host.dataset.counter ?? 0)); },
    toggleLamp,
    /**
     * The room as it is now, cropped to fill `width`×`height` over `background`. The frame is drawn and copied in one go:
     * the renderer keeps no drawing buffer between frames, so a copy taken later would be blank.
     */
    capture(width: number, height: number, background: string) {
      if (disposed || !host.clientWidth || !host.clientHeight) return null;
      const ratio = renderer.getPixelRatio();
      renderer.setPixelRatio(Math.min(4, Math.max(ratio, width / host.clientWidth, height / host.clientHeight)));
      try {
        drawNow();
        const source = renderer.domElement, out = document.createElement('canvas');
        out.width = width; out.height = height;
        const paint = out.getContext('2d'); if (!paint || !source.width || !source.height) return null;
        paint.fillStyle = background; paint.fillRect(0, 0, width, height);
        const scale = Math.max(width / source.width, height / source.height), w = source.width * scale, h = source.height * scale;
        paint.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
        return out;
      } finally { renderer.setPixelRatio(ratio); signature.reset(); render(); }
    },
    pokeAt(clientX, clientY) {
      if (grid.visible) return null;
      const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
      raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
      const hits: { kind: string; at: number; act: () => void }[] = []; const time = performance.now();
      const touched = raycaster.intersectObject(furnitureRoot, true).find(hit => hit.object.userData.pieceId);
      const piece = touched && live.get(touched.object.userData.pieceId);
      if (touched && piece) hits.push({ kind: piece.item.kind, at: touched.distance + .05, act: () => {
        if (isLamp(piece.item.kind)) { toggleLamp(piece.item.id); return; }
        piece.poked = time; selected = piece.item.id; placeGlow();
        for (const interaction of catalog[piece.item.kind].interactions(piece.item)) {
          if (interaction.type === 'open') { if (interaction.panel === 'counter') baristaPerformance.cue('greet', time); onOpen(interaction.panel); }
        }
      } });
      // The barista stands behind the bar, so a click on their body counts as the counter. The card is a wide quad; only its middle strip is the body.
      const barista = baristaStand.visible ? raycaster.intersectObject(baristaStand, false).find(hit => hit.uv && Math.abs(hit.uv.x - .5) < .2 && hit.uv.y > .05 && hit.uv.y < .85) : undefined;
      if (barista) hits.push({ kind: 'bar', at: barista.distance, act: () => { baristaPerformance.cue('greet', time); onOpen('counter'); } });
      const nearest = hits.sort((a, b) => a.at - b.at)[0]; if (!nearest) { if (selected) { selected = null; placeGlow(); render(); } return null; }
      nearest.act(); host.dataset.poked = nearest.kind; render(); return nearest.kind;
    },
    poke(id) {
      const mode = modes.get(id); if (actionOwned.has(id) || !motions.has(id) || mode === 'dozing' || mode === 'leaving') return;
      const time = performance.now(); tapped.set(id, time); cues.set(id, { variant: 'emote', text: Math.random() < .75 ? 'heart' : 'sparkle', until: time + 1300 });
    },
    cheers(active) { cheering = active; },
    grab(id) {
      const motion = motions.get(id); if (actionOwned.has(id) || !motion || !agents.some(agent => agent.id === id && agent.presence !== 'left')) return;
      held = { id, point: { ...motion.position }, lift: 0, original: motion }; host.dataset.held = id;
    },
    drag(id, clientX, clientY) {
      const point = held?.id === id ? floorAt(clientX, clientY) : null; if (!held || !point) return;
      held.point = clampToRect(point, residentDropArea);
    },
    cancel(id) {
      if (held?.id !== id) return;
      motions.set(id, { ...held.original, time: performance.now() }); held = null; delete host.dataset.held;
    },
    drop(id) {
      if (held?.id !== id) return;
      const point = held.point; held = null; delete host.dataset.held;
      const index = agents.findIndex(agent => agent.id === id); const agent = agents[index]; const was = motions.get(id); if (!agent || !was) return;
      const time = performance.now(); const nav = actionNavigation();
      const busy = agent.state === 'working' || (currentSnapshot?.tasks ?? []).some(task => task.toAgent === id && task.leaseUntil != null);
      const desk = index < tables.length ? tables[index] : undefined; const { desk: deskSize } = roomLayout; const { seats } = restSpots(furniture);
      const onDesk = desk !== undefined && ((point.x - desk.x) / (deskSize.rx + .3)) ** 2 + ((point.z - desk.z) / (deskSize.rz + .5)) ** 2 < 1;
      const taken = new Set(agents.flatMap(other => { const slot = other.id === id ? undefined : motions.get(other.id)?.slot; return slot ? [slot] : []; }));
      const seated = Boolean(sprites[index]?.userData.seated);
      let spot: Vec = nearestFree(nav, point) ?? point; let hold: Hold | undefined = busy ? undefined : { kind: 'stay', until: time + 5000 }; let slot: string | undefined;
      if (!busy && onDesk) { spot = workSpot({ x: stations[index].x, z: stations[index].z }, desk, seated, nav); hold = { kind: 'work', until: time + 12_000 }; }
      else if (!busy && seated) {
        const seat = seats.map((at, k) => ({ at, k })).filter(({ at, k }) => !taken.has(`seat:${k}`) && Math.hypot(at.x - point.x, at.z - point.z) < .8).sort((a, b) => Math.hypot(a.at.x - point.x, a.at.z - point.z) - Math.hypot(b.at.x - point.x, b.at.z - point.z))[0];
        if (seat) { spot = { x: seat.at.x, z: seat.at.z }; slot = `seat:${seat.k}`; hold = { kind: 'sit', until: time + 12_000 }; }
      }
      motions.set(id, { position: { ...spot }, target: { ...spot }, path: [], facing: was.facing, pauseUntil: hold?.until ?? 0, mode: was.mode, time, ...(hold ? { hold } : {}), ...(slot ? { slot } : {}) });
      landed.set(id, time); modes.delete(id);
      if (busy) cues.set(id, { variant: 'react', text: '!', until: time + 1600 });
    },
    dispose() {
      setGeneration++; setView?.dispose();
      // three keeps one DFG lookup texture for every renderer, and each renderer that samples it listens for its dispose:
      // a closed room lets go of it like the card plane, or that listener keeps this renderer and its canvas alive.
      let lut: THREE.Texture | undefined;
      scene.traverse(node => { if (!lut && node instanceof THREE.Mesh) for (const material of [node.material].flat()) lut ??= (renderer.properties?.get(material) as { uniforms?: { dfgLUT?: { value?: THREE.Texture } } } | undefined)?.uniforms?.dfgLUT?.value; });
      lut?.dispose();
      surfaces.dispose(); disposed = true; stairLandings.dispose();openFloor.dispose(); actorPositions.clear(); cancelAnimationFrame(frame); sighting?.disconnect(); document.removeEventListener('visibilitychange', visibilityChanged); window.clearInterval(tick); unwatchClock(); observer.disconnect(); renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.domElement.removeEventListener('pointermove', hoverMove); renderer.domElement.removeEventListener('pointerleave', hoverLeave); glow.dispose(); contacts.dispose(); light.dispose(); actionCards.forEach(card => card.dispose()); live.forEach(piece => piece.view.dispose()); live.clear(); lamps.dispose(); models.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); releaseCardPlane(); renderer.dispose();
      // Give the GPU context back now rather than at garbage collection: browsers allow only a handful at once.
      try { renderer.forceContextLoss(); } catch {}
      renderer.domElement.remove(); },
  };
}

import { STUDIO_SET_SPOT, type StudioSet } from '../../shared/studio';
import { hostPlace, studioSetDesk } from './studioSet';
import { studioSetVisual } from './studioSetVisual';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BaristaAppearance, Character } from '../../shared/domain';
import type { PerformanceAct } from '../../shared/performance-script';
import { frameCadence } from './frameCadence';
import { frameSignature } from './frameSignature';
import { graphicsProfile, type GraphicsProfile } from './graphicsQuality';
import { clampRoomAngle, clampRoomZoom, frameRoom, roomFov } from './roomCamera';
import type { SceneryId } from '../../shared/scenery';
import { barSpots, defaultFurniture, interactionsOf, pieces as catalog, type FurnitureItem, type FurnitureKind } from './furniture';
import { furnitureModel, type FurnitureModel } from './furnitureModels';
import { cartScene } from '../cart/cartScene';
import type { Shelf } from '../cart/shelf';
import { hangOnWall } from './pieces';
import { cameraView, Card, dress, frameOf, illustrationFrame, measureImage, orientCard, releaseCardPlane, singleLayout, standeeMaterial, type Layout, type StandeeUniforms } from './standee';
import { baristaBodies, ownerBodies } from './barista';
import { residentSilhouette } from './silhouette';
import type { Vec } from './behavior';
import { buildLight, buildStage } from './light';
import { floorTop, roomFloor, roomSize, roomWalls } from '../../shared/room-dimensions';
import { daylight, type Daylight } from './daylight';
import { defaultRoomBrightness, minRoomBrightness, maxRoomBrightness } from '../../shared/room-lighting-settings';
import { themeFor, type Theme } from './theme';
import { FinishSurfaces } from './finishSurfaces';
import type { RoomFinishChoice } from '../../shared/room-finishes';
import { glowLayer, type GlowTone } from './glow';

export interface Anchor { x: number; y: number; scale: number; width?: number; height?: number }
export interface RoomAnchors { counter: Anchor; barista: Anchor; shelf: Anchor; register: Anchor; /** The owner's standee at the room's centre; a room that has none leaves it out. */ owner?: Anchor }
export type GlowTarget = 'counter' | 'shelf';
export interface CameraView { angle: number; zoom: number; panX: number; panY: number }
export interface RoomDebugApi { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; render(): void; actor: THREE.Object3D }
export type RoomDebugHook = (api: RoomDebugApi) => void;
export interface RoomRenderer { brightness(value: number): void; finish?(choice: RoomFinishChoice): void; update(scenery: SceneryId): void; motion(paused: boolean): void; graphics?(profile: GraphicsProfile): void; sleep?(asleep: boolean): void; open(listener: (panel: 'counter') => void): void; barista(character: Character, appearance?: BaristaAppearance): void; /** The owner's standee at the room's centre: this image (an object URL or path), or the placeholder figure with null. */ owner?(sprite: string | null): void; view(angle: number): void; zoomAt(factor: number, clientX: number, clientY: number): void; zoomBy(factor: number): void; panBy(dx: number, dy: number): void; resetView(): void; cameraView?(): CameraView; restoreView?(view: CameraView): void; glowTarget(target: GlowTarget, reason: 'hover' | 'focus', on: boolean): void; present?(spot: string | null): void; shoot?(shot: PresenterShot | null): void; studioSet?(set: StudioSet | null): void; perform?(act: PerformanceAct, elapsed: number): void; furniture(items: FurnitureItem[]): void; /** Puts the products on the shelf and the register's text on its display. */ shelf(shelf: Shelf): void; capture?(width: number, height: number, background: string): HTMLCanvasElement | null; pokeAt(clientX: number, clientY: number): string | null; dispose(): void }


/** A front camera on the presenter: the script's zoom 1–3, and how far it has turned from the host (0) to the spot's desk (1). */
export interface PresenterShot { zoom: number; toward: number }

/** Where the owner's standee stands: the floor's open middle in front of the counter's left end. */
const ownerSpot = { x: 1, z: -.9 };

export function buildRoom(host: HTMLDivElement, onAnchors: (anchors: RoomAnchors) => void, onReady: () => void, onFailure: () => void, options: { furniture?: FurnitureItem[]; brightness?: number; debug?: RoomDebugHook; graphics?: GraphicsProfile; frameHeight?: number; studioSet?: StudioSet | null }): RoomRenderer {
  // A canvas framed as if it were `frameHeight` CSS pixels tall: the camera's distance cap follows that size, not the real one.
  const framed = (width: number, height: number) => options.frameHeight ? { width: width * options.frameHeight / height, height: options.frameHeight } : { width, height };
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
  const wallMat = themed.wall;
  const { back, left, height, thickness, top } = roomWalls;
  box(roomSize.width, height, thickness, wallMat, roomSize.centreX, top - height / 2, back.z - thickness / 2, .07).castShadow = false;
  box(thickness, height, roomSize.depth - .1, leftWall, left.x - thickness / 2, top - height / 2, roomSize.centreZ, .07).castShadow = false;
  box(roomSize.width - .2, .14, .1, cream, roomSize.centreX, .35, back.z + .05); box(.1, .14, roomSize.depth - .3, cream, left.x + .05, .35, roomSize.centreZ);
  const light = buildLight(scene, renderer, group, track); light.shadowDetail(graphics.shadows === 'simple');
  const furnitureRoot = new THREE.Group(); group.add(furnitureRoot);
  const boundedBrightness = (value: number) => Number.isFinite(value) ? Math.max(minRoomBrightness, Math.min(maxRoomBrightness, value)) : defaultRoomBrightness;
  let roomBrightness = boundedBrightness(options.brightness ?? defaultRoomBrightness); host.dataset.brightness = String(roomBrightness);
  let layoutKey = '';
  /** The studio set standing in the room; furniture it covers is already left out of `furniture`. */
  let studioSet = options.studioSet ?? null, setView: Awaited<ReturnType<typeof studioSetVisual>> | undefined, setGeneration = 0;
  let presenterShot: PresenterShot | null = null;
  mergeStatic(group, new Set([furnitureRoot, closedFloor]));
  let furniture: FurnitureItem[] = [...defaultFurniture];
  type LivePiece = { item: FurnitureItem; node: THREE.Group; model: FurnitureModel; key: string; poked: number };
  const live = new Map<string, LivePiece>();
  let lightingDirty = true;
  const glow = glowLayer(); let hovered: string | null = null;
  const targetLit: Record<GlowTarget, Set<'hover' | 'focus'>> = { counter: new Set(), shelf: new Set() };
  function placeGlow() {
    const targets = new Map<THREE.Object3D, GlowTone>();
    const light = (pieceId: string | null | undefined, as: GlowTone) => { const node = pieceId ? live.get(pieceId)?.node : undefined; if (node && !targets.has(node)) targets.set(node, as); };
    const piece = (kind: FurnitureKind) => furniture.find(entry => entry.kind === kind && !entry.stowed)?.id;
    if (targetLit.counter.size) light(piece('bar'), 'ok');
    if (targetLit.shelf.size) light(piece('beanShelf'), 'ok');
    light(hovered, 'hover');
    glow.set(targets);
  }
  const pieceKey = (item: FurnitureItem) => `${item.kind}:${item.variant}:${item.size ?? 1}:${item.wall ?? ''}`;
  function placePiece(item: FurnitureItem, node: THREE.Group) {
    const spec = catalog[item.kind];
    if (spec.mount === 'wall') { hangOnWall(node, item.wall ?? 'back', item.wall === 'left' ? item.z : item.x, spec.hang!); return; }
    node.userData.baseY = 0; node.position.set(item.x, 0, item.z); node.userData.baseRotationY = -item.turn * Math.PI / 2; node.rotation.set(0, node.userData.baseRotationY, 0);
  }
  function buildPiece(item: FurnitureItem): LivePiece {
    const model = furnitureModel(item);
    model.node.traverse(part => { part.userData.pieceId = item.id; });
    furnitureRoot.add(model.node); placePiece(item, model.node);
    return { item, node: model.node, model, key: pieceKey(item), poked: -Infinity };
  }
  function dropPiece(piece: LivePiece) { glow.invalidate(piece.node); piece.model.dispose(); live.delete(piece.item.id); }
  let bar = barSpots(furniture);
  let counter = { ...bar.counter };
  const cart = cartScene(); group.add(cart.register);
  const shelfPiece = () => [...live.values()].find(piece => piece.item.kind === 'beanShelf');
  /** The products ride on the shelf and the register on the bar, so a tap on either counts as that piece. */
  function seatCart() {
    const shelf = shelfPiece(), barPiece = [...live.values()].find(piece => piece.item.kind === 'bar');
    if (shelf) { shelf.node.add(cart.products); cart.products.traverse(part => { part.userData.pieceId = shelf.item.id; }); } else cart.products.removeFromParent();
    cart.register.visible = Boolean(barPiece); cart.register.position.set(bar.register.x, bar.register.y, bar.register.z); cart.register.rotation.y = -bar.register.turn * Math.PI / 2;
    cart.register.traverse(part => { part.userData.pieceId = barPiece?.item.id; });
  }
  function layFurniture(items: readonly FurnitureItem[]) {
    lightingDirty = true;
    furniture = [...items]; layoutKey = JSON.stringify(items);
    for (const [id, piece] of live) { const next = items.find(item => item.id === id); if (!next || next.stowed || pieceKey(next) !== piece.key) dropPiece(piece); }
    for (const item of items) {
      if (item.stowed) continue;
      let piece = live.get(item.id);
      if (!piece) { piece = buildPiece(item); live.set(item.id, piece); }
      piece.item = item; placePiece(item, piece.node);
    }
    bar = barSpots(furniture); counter = { ...bar.counter };
    seatCart(); placeBarista(); placeGlow(); renderer.shadowMap.needsUpdate = true;
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
  const maps = new Map<string, THREE.Texture>();
  const failed = new Set<string>();
  function avatarTexture(path: string) {
    const existing = maps.get(path); if (existing) return existing;
    const texture = textureLoader.load(path, () => {
      if (disposed) return;
      texture.needsUpdate = true;
      dressStands(); anchors(); render();
    }, undefined, () => { if (disposed) return; failed.add(path); dressStands(); anchors(); render(); });
    texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture); maps.set(path, texture);
    return texture;
  }
  function size(sprite: Card, width: number, height: number, top = height) { sprite.scale.set(width, height, 1); sprite.userData.base = { width, height, top }; }
  const baseSize = (sprite: Card): { width: number; height: number; top: number } => sprite.userData.base ?? { width: 2, height: 2, top: 2 };
  const layouts = new Map<string, Layout>();
  function measured(path: string, image: HTMLImageElement, height?: number) {
    let layout = layouts.get(path);
    if (!layout) { layout = singleLayout(measureImage(image, 1, 1, [[0, 0]]), image.width, image.height, height); layouts.set(path, layout); }
    return layout;
  }
  /** Illustrations need minification filtering, so the one image is drawn into its own frame texture with mipmaps. */
  function wear(sprite: Card, source: THREE.Texture, layout: Layout) {
    const previous = sprite.material.map;
    if (previous) { textures.delete(previous); previous.dispose(); }
    const isolated = layout.pixel ? null : illustrationFrame(source.image as HTMLImageElement, 1, 1, 0, 0);
    if (isolated) isolated.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const map = isolated ?? source.clone(); map.needsUpdate = true; textures.add(map);
    sprite.material.map = map; dress(map, sprite.userData.uniforms, layout, 0, 0);
    sprite.material.needsUpdate = true;
    const f = frameOf(layout); sprite.center.copy(f.center); size(sprite, f.width, f.height, f.top);
  }
  function standCard(flip: number, at: Vec) {
    const { material: m, uniforms } = standeeMaterial(); materials.add(m);
    const sprite = new Card(m); sprite.userData.uniforms = uniforms; sprite.center.set(.5, .045); size(sprite, 2.12, 2.12);
    sprite.flip = flip;
    sprite.position.set(at.x, .3, at.z); sprite.visible = false; group.add(sprite); return sprite;
  }
  const baristaStand = standCard(-1, bar.barista);
  /** The owner's standee stands on the floor's open middle, between the studio set and the counter, clear of the shelf. */
  const ownerStand = standCard(1, ownerSpot);
  /** A performance in this room: where the barista hosts it and the act playing, counted from `since` on the room clock. */
  let presenting: { spot: string; act: PerformanceAct; since: number } | null = null;
  let presenterPlace: { key: string; place: ReturnType<typeof hostPlace> } | null = null;
  function presenterPlaceNow() {
    if (!presenting) return null;
    const key = `${layoutKey}|${presenting.spot}|${JSON.stringify(studioSet)}`;
    if (presenterPlace?.key !== key) presenterPlace = { key, place: hostPlace(presenting.spot, studioSet) };
    return presenterPlace.place;
  }
  /** Behind the bar, or on the host's mark while a performance is on; without walking art the barista is there at once. */
  function placeBarista() {
    const place = presenterPlaceNow();
    const at = place?.stand ?? bar.barista;
    baristaStand.position.set(at.x, .3, at.z);
    baristaStand.flip = place ? 1 : -1;
    if (presenting) host.dataset.presenter = JSON.stringify({ spot: presenting.spot, act: presenting.act, onStage: Boolean(place), seated: false, place });
    else delete host.dataset.presenter;
  }
  let baristaLook: Character = 'clerk'; let baristaOwn: BaristaAppearance | undefined; let ownerSprite: string | null = null;
  /** Puts the first body that loads on `stand` and says which kind it is in `data-<source>`; `place` runs when the image changes. */
  function dressStand(stand: Card, bodies: { src: string; height?: number }[], source: 'baristaSource' | 'ownerSource', place: () => void, kind: (path: string) => string) {
    const body = bodies.find(entry => !failed.has(entry.src)), path = body?.src;
    if (!path || stand.userData.character !== path) {
      stand.visible = false; delete stand.userData.character;
      host.dataset[source] = path ? 'loading' : 'unavailable';
    }
    if (!path) return;
    const texture = avatarTexture(path); const image = texture.image as HTMLImageElement | undefined;
    if (!image) return;
    if (stand.userData.character !== path) {
      wear(stand, texture, measured(path, image, body?.height));
      (stand.userData.uniforms as StandeeUniforms).tint.value.set(light_.tint);
      stand.userData.character = path; place();
    }
    host.dataset[source] = kind(path);
    stand.visible = true;
  }
  const dressBarista = () => dressStand(baristaStand, baristaBodies(baristaLook, baristaOwn), 'baristaSource', placeBarista, path => path === residentSilhouette ? 'silhouette' : baristaOwn?.standee && path === `/media/${baristaOwn.standee.key}` ? 'custom-standee' : 'standee');
  const dressOwner = () => dressStand(ownerStand, ownerBodies(ownerSprite), 'ownerSource', () => {}, path => path === ownerSprite ? 'generated' : 'placeholder');
  const dressStands = () => { dressBarista(); dressOwner(); };
  let currentScenery: SceneryId = 'sage';
  let onOpen: (panel: 'counter') => void = () => {};
  const clock = () => { const now = new Date(); return now.getHours() + now.getMinutes() / 60; };
  let lit = -1; let light_: Daylight = daylight(clock());
  function applyDaylight(hour: number) {
    const d = daylight(hour); lit = hour; light_ = d;
    lightingDirty = true;
    stage.glow.set(d.stage);
    for (const stand of [baristaStand, ownerStand]) (stand.userData.uniforms as StandeeUniforms).tint.value.set(d.tint);
    renderer.toneMappingExposure = d.exposure; renderer.shadowMap.needsUpdate = true;
  }
  const hourNow = () => { const pinned = Number(host.dataset.hour); return host.dataset.hour && Number.isFinite(pinned) ? pinned : clock(); };
  let paused = false; let asleep = false; let disposed = false; let frame = 0; let renderRequested = false; const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let cadence = frameCadence(graphics.fps);
  // An unchanged scene is not drawn again: the loop keeps running, and the canvas keeps its last frame.
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
  function loadSet(value: StudioSet | null, built = true) {
    studioSet = value; const generation = ++setGeneration; setView?.dispose(); setView = undefined;
    if (value) void studioSetVisual(value).then(view => {
      if (disposed || generation !== setGeneration) { view.dispose(); return; }
      setView = view; group.add(view.root); renderer.shadowMap.needsUpdate = true; host.dataset.studioSet = value.preset; frameCamera(); anchors(); render();
    }, () => { if (!disposed && generation === setGeneration) host.dataset.studioSetError = 'The studio set could not be loaded.'; });
    presenterPlace = null;
    if (built) { placeBarista(); anchors(); render(); }
  }
  const raycaster = new THREE.Raycaster();
  function pieceAt(clientX: number, clientY: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObject(furnitureRoot, true).find(entry => entry.object.userData.pieceId);
    return hit ? hit.object.userData.pieceId as string : null;
  }
  let pointer: { x: number; y: number } | null = null; let hoverDirty = false;
  const hoverMove = (event: PointerEvent) => { if (event.pointerType === 'mouse') { pointer = { x: event.clientX, y: event.clientY }; hoverDirty = true; } };
  const hoverLeave = () => { pointer = null; hoverDirty = true; };
  renderer.domElement.addEventListener('pointermove', hoverMove); renderer.domElement.addEventListener('pointerleave', hoverLeave);
  function project(v: THREE.Vector3): Anchor { const p = v.clone().project(camera); return { x: (p.x + 1) * 50, y: (1 - p.y) * 50, scale: Math.min(1, host.clientWidth / 1100) }; }
  function counterAnchor(): Anchor {
    const xs: number[] = [], ys: number[] = [];
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [.24, counter.height + .3]) { const p = project(new THREE.Vector3(counter.x + dx * (counter.halfX + .07), y, counter.z + dz * (counter.halfZ + .07))); xs.push(p.x); ys.push(p.y); }
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), scale: 1 };
  }
  function standAnchor(stand: Card): Anchor {
    const v = stand.position; const { width, top: rise } = baseSize(stand);
    const head = project(new THREE.Vector3(v.x, v.y + rise, v.z)), foot = project(new THREE.Vector3(v.x, v.y, v.z));
    const left = project(new THREE.Vector3(v.x, v.y + 1, v.z - width / 2)), right = project(new THREE.Vector3(v.x, v.y + 1, v.z + width / 2));
    return { ...head, width: Math.max(4, Math.abs(right.x - left.x)), height: Math.abs(foot.y - head.y) };
  }
  /** The screen box around a node, in percent of the canvas. */
  function boxAnchor(node: THREE.Object3D | undefined): Anchor {
    if (!node) return { x: 50, y: 30, width: 10, height: 10, scale: 1 };
    group.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(node);
    const corners = [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => project(new THREE.Vector3(x ? box.max.x : box.min.x, y ? box.max.y : box.min.y, z ? box.max.z : box.min.z)))));
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), scale: 1 };
  }
  function anchors() {
    onAnchors({ counter: counterAnchor(), barista: standAnchor(baristaStand), owner: standAnchor(ownerStand), shelf: boxAnchor(shelfPiece()?.node), register: boxAnchor(cart.register) });
  }
  /**
   * The talk-show camera: level with a seated host's face, a little above it, looking at the set from the front (+z).
   * Zoom 1 shows the host from the desk up with room around them; zoom 3 is a close-up.
   */
  function shootPresenter(shot: PresenterShot, width: number, height: number) {
    const place = presenterPlaceNow(); if (!place) return false;
    const hostAt = place.seat ? new THREE.Vector3(place.seat.x, floorTop + place.seat.height + .62, place.seat.z) : new THREE.Vector3(place.stand.x, floorTop + 1.15, place.stand.z);
    const desk = presenting?.spot === STUDIO_SET_SPOT && studioSet ? studioSetDesk(studioSet) : undefined;
    const deskAt = desk ? new THREE.Vector3(desk.x, floorTop + .95, desk.z) : hostAt.clone();
    const target = hostAt.clone().lerp(deskAt, shot.toward), tall = 3 / Math.max(1, shot.zoom), half = roomFov * Math.PI / 360;
    camera.zoom = 1; camera.fov = roomFov; camera.aspect = width / height; camera.near = .3; camera.far = 400; camera.updateProjectionMatrix();
    const distance = tall / 2 / Math.tan(half), pitch = .12;
    camera.position.set(target.x, target.y + Math.sin(pitch) * distance, target.z + Math.cos(pitch) * distance); camera.lookAt(target); camera.updateMatrixWorld();
    host.dataset.camera = JSON.stringify({ position: camera.position.toArray(), projection: camera.projectionMatrix.toArray(), presenter: shot });
    return true;
  }
  /** What the default view frames: on a phone the counter and shelf, on wider screens the whole shop and the studio set. */
  function framingPoints() {
    const box = new THREE.Box3(), narrow = host.clientWidth < 700;
    for (const piece of live.values()) if (!narrow || piece.item.kind === 'bar' || piece.item.kind === 'beanShelf') box.expandByObject(piece.node);
    if (!narrow && setView) box.expandByObject(setView.root);
    if (narrow) box.expandByObject(ownerStand);
    if (box.isEmpty()) return undefined;
    return [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => new THREE.Vector3(x ? box.max.x : box.min.x, y ? box.max.y : box.min.y, z ? box.max.z : box.min.z))));
  }
  function frameCamera() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    if (presenterShot && shootPresenter(presenterShot, width, height)) return;
    const size = framed(width, height), view = frameRoom(camera, size.width, size.height, cameraAngle, framingPoints()); if (!view) return;
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
    renderer.setSize(width, height); signature.reset(); anchors(); render();
  }
  function zoomAt(factor: number, clientX: number, clientY: number) {
    const rect = host.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const size = framed(rect.width, rect.height), view = frameRoom(camera, size.width, size.height, cameraAngle, framingPoints()); if (!view) return;
    const next = clampRoomZoom(cameraZoom * factor); if (next === cameraZoom) return;
    const { halfW, halfH } = view;
    const nx = (clientX - rect.left) / rect.width * 2 - 1, ny = 1 - (clientY - rect.top) / rect.height * 2;
    cameraPanX += nx * halfW * (1 / cameraZoom - 1 / next);
    cameraPanY += ny * halfH * (1 / cameraZoom - 1 / next);
    cameraZoom = next; frameCamera(); anchors(); render();
  }
  function panBy(dx: number, dy: number) {
    const rect = host.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const size = framed(rect.width, rect.height), view = frameRoom(camera, size.width, size.height, cameraAngle, framingPoints()); if (!view) return;
    cameraPanX -= dx * view.halfW * 2 / rect.width / cameraZoom;
    cameraPanY += dy * view.halfH * 2 / rect.height / cameraZoom;
    frameCamera(); anchors(); render();
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
    if (lightingDirty) {
      light.update(light_, [], theme.light, roomBrightness); lightingDirty = false;
      renderer.shadowMap.needsUpdate = true;
    }
  }
  function animate(time: number) {
    frame = 0;
    if (disposed) return;
    if (document.hidden || offscreen) { cadence.reset(); return; }
    if (asleep) { if (renderRequested) drawIfChanged(); return; }
    frame = requestAnimationFrame(animate);
    const admission = cadence.advance(time);
    if (admission === 'skip') { if (renderRequested) drawIfChanged(); return; }
    for (const stand of [baristaStand, ownerStand]) orientCard(stand, cameraView(camera), reduced.matches || paused ? 1 : .2);
    if (Math.abs(hourNow() - lit) > 1 / 120) applyDaylight(hourNow());
    const calmRoom = reduced.matches || paused || graphics.calmDecor;
    for (const piece of live.values()) {
      const since = time - piece.poked;
      const settled = calmRoom || since > 2000; const node = piece.node;
      const hops = interactionsOf(piece.item, 'poke')[0]?.reaction === 'bounce';
      const hop = settled || !hops ? 0 : Math.abs(Math.sin(since / 120)) * .12 * Math.exp(-since / 300);
      if (catalog[piece.item.kind].mount === 'wall') { node.position.y = catalog[piece.item.kind].hang!.y + hop * .3; continue; }
      const plant = piece.item.kind === 'plant';
      const sway = settled || !plant ? 0 : Math.sin(since / 110) * .14 * Math.exp(-since / 500);
      node.rotation.set(sway * .4, node.userData.baseRotationY ?? -piece.item.turn * Math.PI / 2, sway);
      node.position.y = (node.userData.baseY ?? 0) + hop;
    }
    if (hoverDirty) {
      hoverDirty = false; const next = pointer ? pieceAt(pointer.x, pointer.y) : null;
      if (next !== hovered) { hovered = next; placeGlow(); if (hovered) host.dataset.hovered = ''; else delete host.dataset.hovered; }
    }
    glow.tick(time, calmRoom);
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
  loadSet(studioSet, false);
  applyDaylight(hourNow());
  layFurniture(options.furniture ?? defaultFurniture);
  const observer = new ResizeObserver(() => resize()); observer.observe(host); resize();
  options.debug?.({ scene, camera, renderer, render, actor: baristaStand });
  onReady();
  return {
    update(scenery) {
      currentScenery = scenery;
      if (themeFor(currentScenery) !== theme) { theme = themeFor(currentScenery); surfaces.paint(theme); lit = -1; }
      dressStands(); renderer.shadowMap.needsUpdate = true; anchors(); render();
    },
    finish(choice) { surfaces.choose(choice, theme); renderer.shadowMap.needsUpdate = true; render(); },
    brightness(value) { const next = boundedBrightness(value); if (next === roomBrightness) return; roomBrightness = next; host.dataset.brightness = String(next); lightingDirty = true; render(); },
    view(angle) { cameraAngle = clampRoomAngle(angle); frameCamera(); anchors(); render(); },
    zoomAt,
    zoomBy,
    panBy,
    resetView() { cameraAngle = 0; cameraZoom = 1; cameraPanX = 0; cameraPanY = 0; frameCamera(); anchors(); render(); },
    cameraView() { return { angle: cameraAngle, zoom: cameraZoom, panX: cameraPanX, panY: cameraPanY }; },
    restoreView(view) { cameraAngle = clampRoomAngle(view.angle); cameraZoom = clampRoomZoom(view.zoom); cameraPanX = view.panX; cameraPanY = view.panY; frameCamera(); anchors(); render(); },
    open(listener) { onOpen = listener; },
    barista(character, appearance) { host.dataset.character = character; if (character === baristaLook && JSON.stringify(appearance ?? null) === JSON.stringify(baristaOwn ?? null)) return; baristaLook = character; baristaOwn = appearance; dressBarista(); anchors(); render(); },
    owner(sprite) {
      if (sprite === ownerSprite) return;
      const previous = ownerSprite && maps.get(ownerSprite);
      if (previous) { textures.delete(previous); previous.dispose(); maps.delete(ownerSprite!); layouts.delete(ownerSprite!); failed.delete(ownerSprite!); }
      ownerSprite = sprite; dressOwner(); anchors(); render();
    },
    studioSet(value) { if (JSON.stringify(value) !== JSON.stringify(studioSet)) loadSet(value); },
    shoot(shot) { presenterShot = shot; frameCamera(); anchors(); render(); },
    present(spot) {
      if ((presenting?.spot ?? null) === spot) return;
      presenting = spot ? { spot, act: 'idle', since: performance.now() } : null;
      placeBarista(); anchors(); render();
    },
    perform(act, elapsed) {
      if (!presenting) return;
      const now = performance.now();
      if (act !== presenting.act || Math.abs((now - presenting.since) / 1000 - elapsed) > .25) { presenting = { ...presenting, act, since: now - elapsed * 1000 }; placeBarista(); }
    },
    furniture(items) {
      if (JSON.stringify(items) !== layoutKey) { layFurniture(items); frameCamera(); }
      anchors(); render();
    },
    shelf(shelf) {
      if (cart.show(shelf)) { const shelf = shelfPiece(); if (shelf) glow.invalidate(shelf.node); seatCart(); placeGlow(); }
      host.dataset.cartShelf = String(cart.products.userData.count ?? 0); host.dataset.register = shelf.register;
      renderer.shadowMap.needsUpdate = true; anchors(); render();
    },
    motion(next) { paused = next; },
    graphics(next) { if (!disposed && next !== graphics) applyGraphics(next); },
    sleep(next) { if (disposed || next === asleep) return; asleep = next; cadence.reset(); cancelAnimationFrame(frame); frame = 0; if (!next || renderRequested) frame = requestAnimationFrame(animate); },
    glowTarget(target, reason, on) { if (on) targetLit[target].add(reason); else targetLit[target].delete(reason); placeGlow(); render(); },
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
      const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
      raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
      const hits: { kind: string; at: number; act: () => void }[] = []; const time = performance.now();
      const touched = raycaster.intersectObject(furnitureRoot, true).find(hit => hit.object.userData.pieceId);
      const piece = touched && live.get(touched.object.userData.pieceId);
      if (touched && piece) hits.push({ kind: piece.item.kind, at: touched.distance + .05, act: () => {
        piece.poked = time;
        for (const interaction of catalog[piece.item.kind].interactions(piece.item)) if (interaction.type === 'open' && interaction.panel === 'counter') onOpen('counter');
      } });
      // The barista stands behind the bar, so a click on their body counts as the counter. The card is a wide quad; only its middle strip is the body.
      const barista = baristaStand.visible ? raycaster.intersectObject(baristaStand, false).find(hit => hit.uv && Math.abs(hit.uv.x - .5) < .2 && hit.uv.y > .05 && hit.uv.y < .85) : undefined;
      if (barista) hits.push({ kind: 'bar', at: barista.distance, act: () => onOpen('counter') });
      const nearest = hits.sort((a, b) => a.at - b.at)[0]; if (!nearest) return null;
      nearest.act(); host.dataset.poked = nearest.kind; render(); return nearest.kind;
    },
    dispose() {
      setGeneration++; setView?.dispose();
      // three keeps one DFG lookup texture for every renderer, and each renderer that samples it listens for its dispose:
      // a closed room lets go of it like the card plane, or that listener keeps this renderer and its canvas alive.
      let lut: THREE.Texture | undefined;
      scene.traverse(node => { if (!lut && node instanceof THREE.Mesh) for (const material of [node.material].flat()) lut ??= (renderer.properties?.get(material) as { uniforms?: { dfgLUT?: { value?: THREE.Texture } } } | undefined)?.uniforms?.dfgLUT?.value; });
      lut?.dispose();
      surfaces.dispose(); disposed = true; cancelAnimationFrame(frame); sighting?.disconnect(); document.removeEventListener('visibilitychange', visibilityChanged); observer.disconnect(); renderer.domElement.removeEventListener('webglcontextlost', contextLost); renderer.domElement.removeEventListener('pointermove', hoverMove); renderer.domElement.removeEventListener('pointerleave', hoverLeave); glow.dispose(); light.dispose(); cart.dispose(); live.forEach(piece => piece.model.dispose()); live.clear(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); releaseCardPlane(); renderer.dispose();
      // Give the GPU context back now rather than at garbage collection: browsers allow only a handful at once.
      try { renderer.forceContextLoss(); } catch {}
      renderer.domElement.remove(); },
  };
}

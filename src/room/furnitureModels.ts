import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { floorTop as FLOOR } from '../../shared/room-dimensions';
import { SHELF_COLUMNS } from '../../shared/cart';
import type { FurnitureItem } from './furniture';
import { pieces } from './pieces';

/**
 * `node` is usable at once: it holds a plain stand-in until the glb from PA Cafe replaces it, and keeps the stand-in
 * when the glb cannot be loaded. `ready` settles with true once the real model is in.
 */
export interface FurnitureModel { node: THREE.Group; ready: Promise<boolean>; dispose(): void }

const files = {
  counter: '/furniture/terra-counter.glb',
  shelf: '/furniture/atelier-archive-bookshelf.glb',
  plant: '/furniture/terra-plant.glb',
  cactus: '/furniture/terra-plant-cactus.glb',
  rugRound: '/furniture/terra-rug-round.glb',
  rugStar: '/furniture/terra-rug-star.glb',
  register: '/furniture/terra-cash-register.glb',
} as const;

const sources = new Map<string, Promise<THREE.Object3D>>();
/** One download and parse per file for the page's life; every piece is a clone that shares the parsed geometry. */
export function source(url: string) {
  let found = sources.get(url);
  if (!found) {
    found = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      const root = (await new GLTFLoader().parseAsync(await response.arrayBuffer(), '')).scene;
      root.traverse(part => { if (part instanceof THREE.Mesh) { part.castShadow = true; part.receiveShadow = true; } });
      return root;
    });
    found.catch(() => sources.delete(url));
    sources.set(url, found);
  }
  return found;
}

type Box = readonly [w: number, h: number, d: number, x: number, y: number, z: number];
/** Puts plain boxes in `node`; the returned function takes them out again and frees them. */
function standIn(node: THREE.Group, boxes: readonly Box[], color = '#a8704a') {
  const proxy = new THREE.Group(), geometries: THREE.BufferGeometry[] = [], material = new THREE.MeshStandardMaterial({ color, roughness: .8 });
  for (const [w, h, d, x, y, z] of boxes) {
    const geometry = new THREE.BoxGeometry(w, h, d), mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; proxy.add(mesh); geometries.push(geometry);
  }
  node.add(proxy);
  return () => { proxy.removeFromParent(); geometries.forEach(geometry => geometry.dispose()); material.dispose(); };
}

/** Swaps the stand-in in `node` for what `build` makes from the parsed file; a file that fails to load or build leaves the stand-in. */
function model(node: THREE.Group, url: string, dropStandIn: () => void, build: (original: THREE.Object3D) => THREE.Object3D): FurnitureModel {
  let gone = false;
  const ready = source(url).then(original => {
    if (gone) return false;
    const built = build(original);
    dropStandIn(); node.add(built); return true;
  }, () => false);
  return { node, ready, dispose() { gone = true; node.removeFromParent(); } };
}

/** A clone with its origin on the floor: the planks' top face. */
function standing(original: THREE.Object3D, scale = 1, lift = 0) {
  const clone = original.clone(true); clone.scale.setScalar(scale); clone.position.y = FLOOR + lift; return clone;
}

function bar() {
  const node = new THREE.Group();
  const drop = standIn(node, [[4.3, .91, .8, 0, FLOOR + .455, 0], [.6, .91, 1.1, -1.85, FLOOR + .455, -.95], [3.2, 1.03, .4, .35, FLOOR + .515, -1.45]]);
  return model(node, files.counter, drop, original => standing(original));
}

/** The archive bookcase's measurements in its own glb (metres, origin on the floor and centred on x and z), read off its boards. */
const unit = {
  width: 1.32, back: -.21,
  innerHalfWidth: .6, backFace: -.15, frontEdge: .19, board: .06,
  /** Top face of each board and the underside of the board above it, top level first. */
  levels: [{ floor: 1.48, ceiling: 1.91 }, { floor: 1.04, ceiling: 1.42 }, { floor: .6, ceiling: .98 }, { floor: .16, ceiling: .54 }],
  height: 1.97,
  structure: ['oak', 'walnut'],
  columns: 2,
} as const;
const unitScale = 1.2, units = SHELF_COLUMNS / unit.columns;
const wall = -pieces.beanShelf.hang!.depth;

export const shelfFrame = { width: units * unit.width * unitScale, height: unit.height * unitScale } as const;
const unitX = (index: number) => (index - (units - 1) / 2) * unit.width * unitScale;
const unitY = -shelfFrame.height / 2, unitZ = wall - unit.back * unitScale;

/** Where product slot `slot` stands on the shelf, in the shelf's own frame, and the room it has there. Rows fill from the top level down. */
export function shelfSlot(slot: number) {
  const row = Math.floor(slot / SHELF_COLUMNS), column = slot % SHELF_COLUMNS, { floor, ceiling } = unit.levels[row], cell = 2 * unit.innerHalfWidth * unitScale / unit.columns;
  return {
    x: unitX(Math.floor(column / unit.columns)) - unit.innerHalfWidth * unitScale + cell * (column % unit.columns + .5),
    y: unitY + floor * unitScale, z: unitZ + (unit.backFace + unit.frontEdge) / 2 * unitScale,
    width: cell, height: (ceiling - floor) * unitScale, depth: (unit.frontEdge - unit.backFace) * unitScale,
  };
}

/** The archive bookcase `units` times side by side with its books taken out, so the cart's products take their places. */
export function bookshelf(original: THREE.Object3D) {
  const shelf = new THREE.Group();
  for (let index = 0; index < units; index++) {
    const clone = original.clone(true), books: THREE.Object3D[] = [];
    clone.traverse(part => { if (part instanceof THREE.Mesh && !(unit.structure as readonly string[]).includes(part.material.name)) books.push(part); });
    books.forEach(part => part.removeFromParent());
    clone.scale.setScalar(unitScale); clone.position.set(unitX(index), unitY, unitZ); shelf.add(clone);
  }
  return shelf;
}

function shelf() {
  const node = new THREE.Group(), board = unit.board * unitScale, depth = (unit.frontEdge - unit.back) * unitScale, middle = unitZ + (unit.frontEdge + unit.back) / 2 * unitScale;
  const drop = standIn(node, [
    [shelfFrame.width, shelfFrame.height, board / 2, 0, 0, wall + board / 4],
    ...[-1, 1].map((side): Box => [board, shelfFrame.height, depth, side * (shelfFrame.width / 2 - board / 2), 0, middle]),
    ...unit.levels.map((level): Box => [shelfFrame.width, board, depth, 0, unitY + level.floor * unitScale - board / 2, middle]),
  ]);
  return model(node, files.shelf, drop, bookshelf);
}

function plant(item: FurnitureItem) {
  const node = new THREE.Group(), size = item.size ?? 1;
  const drop = standIn(node, [[.5 * size, .46 * size, .5 * size, 0, FLOOR + .23 * size, 0], [.5 * size, .9 * size, .5 * size, 0, FLOOR + .9 * size, 0]], '#5f8f4e');
  return model(node, item.variant === 'cactus' ? files.cactus : files.plant, drop, original => standing(original, size));
}

function rug(item: FurnitureItem) {
  const node = new THREE.Group();
  const drop = standIn(node, [[3, .014, 3, 0, FLOOR + .007, 0]], '#e8b38f');
  return model(node, item.variant === 'star' ? files.rugStar : files.rugRound, drop, original => standing(original, 1, .001));
}

const builders: Record<FurnitureItem['kind'], (item: FurnitureItem) => FurnitureModel> = { bar, beanShelf: shelf, plant, rug };
export const furnitureModel = (item: FurnitureItem) => builders[item.kind](item);

const registerScale = 1.4;
/**
 * The register for the counter's top. `display` sits on the model's own screen, facing out of it, scaled to the 4:1 area a
 * total fits in: put a 1×1 plane in it and paint the total at 4:1.
 */
export function registerModel() {
  const node = new THREE.Group(), display = new THREE.Group();
  const drop = standIn(node, [[.62, .3, .5, 0, .15, 0]], '#3f5a4c');
  display.position.set(0, .2, .26); display.scale.set(.3, .075, 1); node.add(display);
  const loaded = model(node, files.register, drop, original => {
    const clone = original.clone(true), screens: THREE.Mesh[] = [];
    clone.scale.setScalar(registerScale);
    clone.traverse(part => { if (part instanceof THREE.Mesh && part.material.name === 'screen') screens.push(part); });
    if (!screens.length) throw new Error('The register model has no screen.');
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(screens[0]), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3()), width = Math.min(size.x, size.y * 4);
    display.position.set(centre.x, centre.y, box.max.z + .004); display.scale.set(width, width / 4, 1);
    const built = new THREE.Group(); built.add(clone, display); return built;
  });
  return { ...loaded, display };
}

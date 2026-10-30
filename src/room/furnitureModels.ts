import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { floorTop as FLOOR } from '../../shared/room-dimensions';
import type { FurnitureItem } from './furniture';

export interface FurnitureModel { node: THREE.Group; dispose(): void }

/** The cart shelf's boards in its own frame: the origin hangs `hang.depth` off the wall, centred on the shelf. */
export const shelfFrame = { width: 2.6, height: 1.95, depth: .34, back: -.18, rows: 3, columns: 4, board: .05, firstBoard: -.95, rowPitch: .605 } as const;

function kit() {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Map<string, THREE.MeshStandardMaterial>();
  const node = new THREE.Group();
  const paint = (color: string, roughness = .7) => { let m = materials.get(`${color}:${roughness}`); if (!m) materials.set(`${color}:${roughness}`, m = new THREE.MeshStandardMaterial({ color, roughness })); return m; };
  const add = (geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, roughness?: number, parent: THREE.Object3D = node) => {
    geometries.add(geometry); const mesh = new THREE.Mesh(geometry, paint(color, roughness)); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, radius = .03, roughness?: number) => add(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), color, x, y, z, roughness);
  return { node, add, box, model: (): FurnitureModel => ({ node, dispose() { node.removeFromParent(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } }) };
}

const barTones: Record<string, { body: string; panel: string; top: string }> = {
  walnut: { body: '#7b4f33', panel: '#94603e', top: '#efe1c8' },
  oak: { body: '#c08f5c', panel: '#d2a472', top: '#f4ead8' },
};
/** The L-shaped counter of pieces/bar.ts: the front run, the return on the left and the back cabinet the shelf hangs over. */
function bar(item: FurnitureItem) {
  const { box, model } = kit(); const tone = barTones[item.variant] ?? barTones.walnut;
  const run = (x: number, z: number, w: number, d: number, top: number) => {
    box(w, top - .08 - FLOOR, d, tone.body, x, (FLOOR + top - .08) / 2, z, .04);
    box(w + .1, .08, d + .1, tone.top, x, top - .04, z, .03, .45);
    box(w - .04, .1, d - .04, '#4b3020', x, FLOOR + .05, z, .02);
  };
  run(0, 0, 4.3, .8, 1.13); run(-1.85, -.95, .6, 1.1, 1.13); run(.35, -1.45, 3.2, .4, 1.19);
  for (const x of [-1.45, 0, 1.45]) box(1.2, .52, .03, tone.panel, x, .66, .41, .02);
  return model();
}

/** Three boards of four slots, with side panels and a back panel against the wall. */
function shelf() {
  const { box, model } = kit(); const { width, height, depth, back, rows, board, firstBoard, rowPitch } = shelfFrame;
  const wood = '#b98352', front = back + depth / 2;
  box(width, height, .04, '#e9d3b2', 0, 0, back, .02);
  for (const side of [-1, 1]) box(.06, height, depth, wood, side * (width / 2 - .03), 0, front, .02);
  for (let k = 0; k <= rows; k++) box(width, board, depth, wood, 0, firstBoard + k * rowPitch, front, .015);
  box(width + .06, .08, depth + .04, '#8f6440', 0, height / 2 + .02, front, .02);
  return model();
}

function plant(item: FurnitureItem) {
  const { add, model } = kit(); const s = item.size ?? 1;
  add(new THREE.CylinderGeometry(.3 * s, .23 * s, .46 * s, 24), '#c7764c', 0, FLOOR + .23 * s, 0);
  add(new THREE.CylinderGeometry(.27 * s, .27 * s, .02, 24), '#5b3f2a', 0, FLOOR + .46 * s, 0);
  const leaves = item.variant === 'cactus' ? [[0, .95, 0, .16, .5]] : [[0, 1.05, 0, .32, .42], [.2, .9, .12, .26, .34], [-.2, .92, -.1, .26, .36], [.05, 1.3, -.08, .22, .3], [-.12, .8, .2, .22, .28]];
  for (const [x, y, z, r, h] of leaves) add(new THREE.SphereGeometry(1, 18, 14).scale(r * s, h * s, r * s), item.variant === 'cactus' ? '#6f9b5a' : '#5f8f4e', x * s, FLOOR + y * s, z * s, .8);
  return model();
}

function rug(item: FurnitureItem) {
  const { add, model } = kit();
  add(new THREE.CylinderGeometry(1.7, 1.7, .014, 64), item.variant === 'star' ? '#d9b8e0' : '#e8b38f', 0, FLOOR + .007, 0, .95).castShadow = false;
  add(new THREE.CylinderGeometry(1.25, 1.25, .016, 64), '#f6dcc0', 0, FLOOR + .008, 0, .95).castShadow = false;
  return model();
}

const builders: Record<FurnitureItem['kind'], (item: FurnitureItem) => FurnitureModel> = { bar, beanShelf: shelf, plant, rug };
export const furnitureModel = (item: FurnitureItem) => builders[item.kind](item);

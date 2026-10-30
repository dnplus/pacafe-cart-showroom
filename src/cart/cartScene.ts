import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cartView, formatTwd, SHELF_COLUMNS, SHELF_SLOTS, type CartItem } from '../../shared/cart';
import { shelfFrame } from '../room/furnitureModels';

/** What the register's display reads: the cart's total, worked out the same way as everywhere else in the room. */
export const registerText = (items: readonly CartItem[]) => formatTwd(cartView(items).totalTwd);

/** Where slot `slot` stands in the shelf's own frame: rows fill from the top board down, left to right. */
export function shelfSlotPosition(slot: number) {
  const row = Math.floor(slot / SHELF_COLUMNS), column = slot % SHELF_COLUMNS, cell = shelfFrame.width / SHELF_COLUMNS;
  return { x: -shelfFrame.width / 2 + cell * (column + .5), y: shelfFrame.firstBoard + (shelfFrame.rows - 1 - row) * shelfFrame.rowPitch + shelfFrame.board / 2, z: shelfFrame.back + shelfFrame.depth / 2 };
}

const palette = ['#e58f6b', '#6f9fc4', '#e2b64f', '#8bb174', '#b48ac8', '#d9707f', '#5fa8a0', '#c99c6b'];
/** A stable number per item, so a product keeps its box and colour across polls. */
const seed = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
const font = (weight: number, size: number) => `${weight} ${size}px "Nunito Sans Variable", "PingFang TC", "Noto Sans TC", sans-serif`;
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number) {
  const out: string[] = []; let line = '';
  for (const char of text) {
    if (ctx.measureText(line + char).width > width && line) { out.push(line); line = ''; if (out.length === lines) break; }
    line += char;
  }
  if (out.length < lines && line) out.push(line);
  if (out.join('').length < text.length) out[out.length - 1] = `${out[out.length - 1].slice(0, -1)}…`;
  return out;
}

function product(item: CartItem) {
  const h = seed(item.id), colour = palette[h % palette.length];
  const width = .5 + (h >> 4) % 10 * .012, height = .36 + (h >> 8) % 14 * .013, depth = .26 + (h >> 12) % 6 * .01;
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = [];
  const node = new THREE.Group(); node.name = `cart-item:${item.id}`;
  const body = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 2, .025), new THREE.MeshStandardMaterial({ color: colour, roughness: .55 }));
  body.position.y = height / 2; body.castShadow = true; body.receiveShadow = true; node.add(body);
  geometries.push(body.geometry); materials.push(body.material);
  const label = canvasTexture(320, 240, ctx => {
    ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.roundRect(0, 0, 320, 240, 26); ctx.fill();
    ctx.fillStyle = '#2f3d35'; ctx.font = font(800, 44); ctx.textBaseline = 'top';
    wrap(ctx, item.title, 288, 2).forEach((line, k) => ctx.fillText(line, 16, 18 + k * 52));
    ctx.fillStyle = colour; ctx.fillRect(16, 134, 288, 6);
    ctx.fillStyle = '#9a4e2f'; ctx.font = font(900, 50);
    ctx.fillText(item.priceTwd === null ? '—' : formatTwd(item.priceTwd), 16, 156);
    if (item.qty > 1) { ctx.textAlign = 'right'; ctx.fillStyle = '#2f3d35'; ctx.font = font(900, 44); ctx.fillText(`×${item.qty}`, 304, 160); }
  });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(width * .9, Math.min(height * .82, width * .9 * .75)), new THREE.MeshBasicMaterial({ map: label, toneMapped: false }));
  card.position.set(0, height / 2, depth / 2 + .003); node.add(card);
  geometries.push(card.geometry); materials.push(card.material); textures.push(label);
  return { node, dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); } };
}

function register() {
  const node = new THREE.Group(); node.name = 'cart-register';
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = node) => {
    geometries.push(geometry); materials.push(material); const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const shell = new THREE.MeshStandardMaterial({ color: '#f1e6d3', roughness: .5 }), trim = new THREE.MeshStandardMaterial({ color: '#3f5a4c', roughness: .6 });
  part(new RoundedBoxGeometry(.62, .12, .5, 2, .03), trim, 0, .06, 0);
  part(new RoundedBoxGeometry(.58, .2, .46, 2, .04), shell, 0, .22, -.01);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) part(new RoundedBoxGeometry(.07, .025, .06, 1, .01), trim, -.12 + c * .085, .335, .1 - r * .075);
  part(new THREE.CylinderGeometry(.03, .04, .16, 12), trim, .05, .4, -.14);
  const screen = new THREE.Group(); screen.position.set(.05, .5, -.12); screen.rotation.x = -.35; node.add(screen);
  part(new RoundedBoxGeometry(.5, .22, .06, 2, .02), trim, 0, 0, 0, screen);
  let current = '';
  const face = new THREE.MeshBasicMaterial({ toneMapped: false }); materials.push(face);
  const display = part(new THREE.PlaneGeometry(.44, .16), face, 0, 0, .031, screen); display.name = 'cart-register-display';
  return {
    node,
    show(text: string) {
      if (text === current) return; current = text;
      face.map?.dispose();
      face.map = canvasTexture(440, 160, ctx => {
        ctx.fillStyle = '#17302a'; ctx.fillRect(0, 0, 440, 160);
        ctx.fillStyle = '#b9f3a0'; ctx.font = font(900, text.length > 11 ? 58 : 72); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 220, 84, 412);
      });
      face.needsUpdate = true; display.userData.text = text;
    },
    dispose() { face.map?.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); },
  };
}

export function cartScene() {
  const products = new THREE.Group(); products.name = 'cart-products';
  const till = register();
  let drawn = new Map<string, { key: string; view: ReturnType<typeof product> }>();
  return {
    products, register: till.node,
    /** Draws `items`; true when anything on the shelf changed. */
    show(items: readonly CartItem[]) {
      till.show(registerText(items));
      const next = new Map<string, { key: string; view: ReturnType<typeof product> }>();
      let changed = false;
      for (const item of items) {
        if (item.shelfSlot >= SHELF_SLOTS) continue;
        const key = JSON.stringify([item.title, item.priceTwd, item.qty]); let entry = drawn.get(item.id);
        if (entry && entry.key !== key) { entry.view.node.removeFromParent(); entry.view.dispose(); entry = undefined; }
        if (!entry) { entry = { key, view: product(item) }; products.add(entry.view.node); changed = true; }
        const at = shelfSlotPosition(item.shelfSlot); entry.view.node.position.set(at.x, at.y, at.z);
        next.set(item.id, entry);
      }
      for (const [id, entry] of drawn) if (!next.has(id)) { entry.view.node.removeFromParent(); entry.view.dispose(); changed = true; }
      drawn = next;
      products.userData.count = drawn.size;
      return changed;
    },
    dispose() { for (const entry of drawn.values()) entry.view.dispose(); drawn.clear(); till.dispose(); products.removeFromParent(); till.node.removeFromParent(); },
  };
}

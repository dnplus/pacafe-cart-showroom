import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SHELF_SLOTS } from '../../shared/cart';
import { registerModel, shelfSlot } from '../room/furnitureModels';
import type { Shelf, ShelfItem } from './shelf';

const palette = ['#e58f6b', '#6f9fc4', '#e2b64f', '#8bb174', '#b48ac8', '#d9707f', '#5fa8a0', '#c99c6b'];
/** A stable number per title, so a product keeps its box and colour across polls, and looks the same to the owner and to visitors. */
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

/** Fired on the room's host when a product on the shelf is clicked; `detail.key` is the ShelfItem's key. */
export const PRODUCT_POKED = 'cart-product';

const PICTURE_RETRY_MS = 10_000;
const CARD_W = 320, CARD_H = 240, PICTURE_H = 148;

/** Paints a product's label card; with a picture the picture takes the upper part and the title shrinks to one line. */
function paintCard(ctx: CanvasRenderingContext2D, item: ShelfItem, colour: string, picture: ImageBitmap | null) {
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.roundRect(0, 0, CARD_W, CARD_H, 26); ctx.fill();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (picture) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, CARD_W, PICTURE_H, [26, 26, 0, 0]); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, PICTURE_H);
    const scale = Math.max(CARD_W / picture.width, PICTURE_H / picture.height), w = picture.width * scale, h = picture.height * scale;
    ctx.drawImage(picture, (CARD_W - w) / 2, (PICTURE_H - h) / 2, w, h);
    ctx.restore();
    ctx.fillStyle = colour; ctx.fillRect(0, PICTURE_H, CARD_W, 5);
    ctx.fillStyle = '#2f3d35'; ctx.font = font(800, 30);
    wrap(ctx, item.title, 288, 1).forEach(line => ctx.fillText(line, 16, PICTURE_H + 12));
  } else {
    ctx.fillStyle = '#2f3d35'; ctx.font = font(800, 44);
    wrap(ctx, item.title, 288, 2).forEach((line, k) => ctx.fillText(line, 16, 18 + k * 52));
    ctx.fillStyle = colour; ctx.fillRect(16, 134, 288, 6);
  }
  const y = picture ? PICTURE_H + 46 : 156, room = item.qty > 1 ? 210 : 288, max = picture ? 40 : 50;
  if (item.price !== null) {
    let size = max; ctx.fillStyle = '#9a4e2f'; ctx.font = font(900, size);
    while (size > 28 && ctx.measureText(item.price).width > room) { size -= 4; ctx.font = font(900, size); }
    ctx.fillText(item.price, 16, y + (max - size) / 2, room);
  }
  if (item.qty > 1) { ctx.textAlign = 'right'; ctx.fillStyle = '#2f3d35'; ctx.font = font(900, picture ? 38 : 44); ctx.fillText(`×${item.qty}`, 304, y + 4); }
}

/** The product box the shelf draws, sized to fit `space`; the unboxing stage draws the very same one, with a finer label (`labelScale`). */
export function productBox(item: ShelfItem, space: { width: number; height: number; depth: number }, loadImage?: Shelf['loadImage'], labelScale = 1) {
  const h = seed(item.title), colour = palette[h % palette.length];
  const wanted = { width: .5 + (h >> 4) % 10 * .012, height: .36 + (h >> 8) % 14 * .013, depth: .26 + (h >> 12) % 6 * .01 };
  const fit = Math.min(1, space.width * .9 / wanted.width, space.height * .9 / wanted.height, space.depth * .9 / wanted.depth);
  const width = wanted.width * fit, height = wanted.height * fit, depth = wanted.depth * fit;
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = [];
  const node = new THREE.Group(); node.name = 'cart-item';
  const body = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 2, .025), new THREE.MeshStandardMaterial({ color: colour, roughness: .55 }));
  body.position.y = height / 2; body.castShadow = true; body.receiveShadow = true; node.add(body);
  geometries.push(body.geometry); materials.push(body.material);
  const canvas = document.createElement('canvas'); canvas.width = CARD_W * labelScale; canvas.height = CARD_H * labelScale;
  const ctx = canvas.getContext('2d')!; ctx.scale(labelScale, labelScale); paintCard(ctx, item, colour, null);
  const label = new THREE.CanvasTexture(canvas); label.colorSpace = THREE.SRGBColorSpace; label.anisotropy = 4;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(width * .9, Math.min(height * .82, width * .9 * .75)), new THREE.MeshBasicMaterial({ map: label, toneMapped: false }));
  card.position.set(0, height / 2, depth / 2 + .003); node.add(card);
  geometries.push(card.geometry); materials.push(card.material); textures.push(label);
  node.traverse(part => { part.userData.cartKey = item.key; });
  let disposed = false;
  const fetchPicture = (retries: number) => void loadImage!(item.image!).then(picture => {
    if (disposed) return;
    if (!picture) { if (retries) setTimeout(() => { if (!disposed) fetchPicture(retries - 1); }, PICTURE_RETRY_MS); return; }
    paintCard(ctx, item, colour, picture); label.needsUpdate = true;
  });
  if (item.image && loadImage) fetchPicture(2);
  return { node, height, dispose() { disposed = true; geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); } };
}

function product(item: ShelfItem, slot: number, loadImage?: Shelf['loadImage']) {
  const built = productBox(item, shelfSlot(slot), loadImage); built.node.name = `cart-item:${slot}`;
  return built;
}

const LAND_MS = 560;
/** 0 to 1 over the landing, overshooting a little past 1 on the way down so the box thumps onto its board. */
export const landing = (progress: number) => { const p = Math.min(1, Math.max(0, progress)) - 1; return 1 + 2.4 * p * p * p + 1.4 * p * p; };

function register() {
  const model = registerModel(); model.node.name = 'cart-register';
  let current = '';
  const face = new THREE.MeshBasicMaterial({ toneMapped: false }), plane = new THREE.PlaneGeometry(1, 1);
  const display = new THREE.Mesh(plane, face); display.name = 'cart-register-display'; model.display.add(display);
  return {
    node: model.node, ready: model.ready,
    show(text: string) {
      if (text === current) return; current = text;
      face.map?.dispose();
      face.map = canvasTexture(512, 128, ctx => {
        ctx.fillStyle = '#17302a'; ctx.fillRect(0, 0, 512, 128);
        ctx.fillStyle = '#b9f3a0'; ctx.font = font(900, text.length > 11 ? 64 : 84); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 68, 488);
      });
      face.needsUpdate = true; display.userData.text = text;
    },
    dispose() { face.map?.dispose(); face.dispose(); plane.dispose(); model.dispose(); },
  };
}

export function cartScene() {
  const products = new THREE.Group(); products.name = 'cart-products';
  const till = register();
  type Entry = { key: string; view: ReturnType<typeof product>; landedAt?: number };
  let drawn = new Map<number, Entry>(), ticking = 0;
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const place = (entry: Entry, slot: number, now: number) => {
    const at = shelfSlot(slot), progress = entry.landedAt === undefined ? 1 : (now - entry.landedAt) / LAND_MS, ease = landing(progress);
    entry.view.node.position.set(at.x, at.y + .002 + (1 - ease) * .55, at.z);
    entry.view.node.scale.setScalar(.55 + .45 * Math.min(1, ease));
    if (progress >= 1) entry.landedAt = undefined;
  };
  const tick = (now: number) => {
    ticking = 0; let busy = false;
    for (const [slot, entry] of drawn) if (entry.landedAt !== undefined) { place(entry, slot, now); busy ||= entry.landedAt !== undefined; }
    if (busy) ticking = requestAnimationFrame(tick);
  };
  return {
    products, register: till.node, ready: till.ready,
    /** Draws `shelf`; true when anything on the shelf changed. */
    show(shelf: Shelf) {
      till.show(shelf.register);
      const next = new Map<number, Entry>();
      let changed = false, anyLanding = false;
      shelf.items.slice(0, SHELF_SLOTS).forEach((item, slot) => {
        const key = JSON.stringify([item.title, item.price, item.qty, item.image]); let entry = drawn.get(slot);
        if (entry && entry.key !== key) { entry.view.node.removeFromParent(); entry.view.dispose(); entry = undefined; }
        if (!entry) {
          entry = { key, view: product(item, slot, shelf.loadImage) };
          if (item.lands && !reduced() && typeof requestAnimationFrame === 'function') { entry.landedAt = performance.now(); anyLanding = true; }
          products.add(entry.view.node); changed = true;
        }
        place(entry, slot, performance.now());
        next.set(slot, entry);
      });
      for (const [id, entry] of drawn) if (!next.has(id)) { entry.view.node.removeFromParent(); entry.view.dispose(); changed = true; }
      drawn = next;
      products.userData.count = drawn.size;
      if (anyLanding && !ticking) ticking = requestAnimationFrame(tick);
      return changed;
    },
    dispose() { cancelAnimationFrame(ticking); for (const entry of drawn.values()) entry.view.dispose(); drawn.clear(); till.dispose(); products.removeFromParent(); till.node.removeFromParent(); },
  };
}

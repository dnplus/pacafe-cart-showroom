import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SHELF_SLOTS } from '../../shared/cart';
import { registerModel, shelfSlot } from '../room/furnitureModels';
import { canvasTexture, cardFace, fitCard, font } from './cardFace';
import { seed, shelfColour, type Shelf, type ShelfItem } from './shelf';
import type { ImageLoader } from './productImage';

export const PRODUCT_POKED = 'cart-product';

function productBox(item: ShelfItem, space: { width: number; height: number; depth: number }, loadImage?: ImageLoader, labelScale = 1) {
  const h = seed(item.title), colour = shelfColour(item);
  const wanted = { width: .5 + (h >> 4) % 10 * .012, height: .36 + (h >> 8) % 14 * .013, depth: .26 + (h >> 12) % 6 * .01 };
  const fit = Math.min(1, space.width * .9 / wanted.width, space.height * .9 / wanted.height, space.depth * .9 / wanted.depth);
  const width = wanted.width * fit, height = wanted.height * fit, depth = wanted.depth * fit;
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const node = new THREE.Group(); node.name = 'cart-item';
  const body = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 2, .025), new THREE.MeshStandardMaterial({ color: colour, roughness: .55 }));
  body.position.y = height / 2; body.castShadow = true; body.receiveShadow = true; node.add(body);
  geometries.push(body.geometry); materials.push(body.material);
  const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }));
  const face = cardFace(item, (texture, aspect) => {
    card.material.map = texture; card.material.needsUpdate = true;
    const fitted = fitCard(aspect, width * .9, height * .82); card.scale.set(fitted.width, fitted.height, 1);
  }, loadImage, labelScale);
  card.position.set(0, height / 2, depth / 2 + .003); node.add(card);
  geometries.push(card.geometry); materials.push(card.material);
  node.traverse(part => { part.userData.cartKey = item.key; });
  return { node, height, dispose() { face.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); } };
}

function product(item: ShelfItem, slot: number, loadImage?: ImageLoader) {
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

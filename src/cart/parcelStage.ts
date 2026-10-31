import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Packaging } from '../../shared/packaging';
import { rarityOf } from '../../shared/packaging';
import { cardFace } from './cartScene';
import { shelfColour } from './shelf';
import type { ImageLoader } from './productImage';
import type { ShelfItem } from './shelf';

export interface StageParcel { id: string; packaging: Packaging; store: string | null; product: ShelfItem }
export interface StageOptions {
  mode: 'single' | 'pull';
  /** Under reduced motion nothing travels, spins or bursts: the flaps are open at once and the product fades in. */
  reduced: boolean;
  loadImage?: ImageLoader;
  shelf?: () => DOMRect | null;
}
export interface ParcelStage { open(index: number): void; shake(index: number | null): void; dispose(): void }

const TAPE = { cream: 0xf0e2b8, red: 0xd95d52, brown: 0xa07850, blue: 0x6c9bc4, washi: 0xf4b9c9 } as const;
const GOLD = 0xffd14a;
const W = 1.6, H = 1.0, D = 1.1, FLAP_T = .05;
/** Seconds after the cut: tape peels, flaps spring open, the product rises, holds, then flies to the shelf (the page's reveal is REVEAL_MS long). */
const T_FLAPS = .15, T_RISE = .45, RISE_S = 1.1, T_FLY = 2.6, T_END = 3.4;
const ease = { out: (u: number) => 1 - (1 - u) ** 3, inOut: (u: number) => u < .5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2, in: (u: number) => u ** 3 };
const spring = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.exp(-5 * u) * Math.cos(9 * u);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const rand = (seed: number) => { let s = seed >>> 0 || 1; return () => (s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0, s / 4294967296); };

function glowTexture(inner: string, outer: string) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!, g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
function raysTexture(colour: string) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!; ctx.translate(128, 128);
  for (let i = 0; i < 14; i++) { ctx.rotate(Math.PI / 7); ctx.fillStyle = colour; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-9, -128); ctx.lineTo(9, -128); ctx.closePath(); ctx.fill(); }
  const fade = ctx.createRadialGradient(0, 0, 10, 0, 0, 128); fade.addColorStop(0, '#fff'); fade.addColorStop(1, '#fff0');
  ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = fade; ctx.fillRect(-128, -128, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

interface Flap { pivot: THREE.Group; axis: 'x' | 'z'; sign: number; max: number; delay: number }
interface Slot {
  parcel: StageParcel; index: number; group: THREE.Group; body: THREE.MeshStandardMaterial; flaps: Flap[]; tape: THREE.Mesh[]; tapeMat: THREE.MeshStandardMaterial;
  filler: { mesh: THREE.InstancedMesh; pos: Float32Array; vel: Float32Array; launched: boolean; update(dt: number, t: number): void };
  rare: boolean; fine: boolean; opened: number | null; shaking: boolean; origin: THREE.Vector3; scale: number;
  product?: { built: { dispose(): void }; node: THREE.Group }; burst?: { flash: THREE.Sprite; rays: THREE.Mesh; sparks: THREE.Points; dirs: Float32Array; aura: THREE.Sprite };
}

export function createParcelStage(host: HTMLElement, parcels: readonly StageParcel[], options: StageOptions): ParcelStage {
  const { reduced, mode } = options, many = mode === 'pull';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  // Capped at 2; a software renderer (no GPU) gets half that so the cascade still keeps its timing.
  const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info'), software = /swiftshader|llvmpipe|software/i.test(String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''));
  renderer.setPixelRatio(software ? .5 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = 'stage-canvas'; host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c7a0, 1.15));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.4); key.position.set(3, 6, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec5ff, .9); rim.position.set(-4, 3, -3); scene.add(rim);
  const flare = new THREE.PointLight(GOLD, 0, 9); flare.position.set(0, 2.4, 1.8); scene.add(flare);

  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(thing: T) => (disposables.push(thing), thing);
  const flashTex = own(glowTexture('rgba(255,251,230,1)', 'rgba(255,224,138,0)')), goldTex = own(glowTexture('rgba(255,236,150,1)', 'rgba(255,190,40,0)')), shadowTex = own(glowTexture('rgba(60,40,10,.55)', 'rgba(60,40,10,0)'));
  const raysTex = own(raysTexture('rgba(255,243,184,.9)')), goldRaysTex = own(raysTexture('rgba(255,209,74,.95)'));
  const bodyGeo = own(new RoundedBoxGeometry(W, H, D, 4, .07)), insideGeo = own(new THREE.PlaneGeometry(W - .2, D - .2));
  const majorGeo = own(new RoundedBoxGeometry(W + .02, FLAP_T, D / 2 + .01, 2, .02)), minorGeo = own(new RoundedBoxGeometry(D / 2 + .01, FLAP_T, D, 2, .02));
  const tapeGeo = own(new THREE.BoxGeometry((W + .12) / 2, .02, .24)), labelGeo = own(new THREE.PlaneGeometry(W * .62, W * .62 * .75)), shadowGeo = own(new THREE.PlaneGeometry(1, 1)), raysGeo = own(new THREE.PlaneGeometry(1, 1));
  const insideMat = own(new THREE.MeshStandardMaterial({ color: 0x2b1d10, roughness: 1 }));
  const shadowMat = own(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));

  const narrow = host.clientWidth < host.clientHeight, cols = many ? (parcels.length <= 5 && !narrow ? parcels.length : Math.ceil(parcels.length / 2)) : 1, rows = many ? Math.ceil(parcels.length / cols) : 1;
  const stepX = 2.05, stepZ = 1.8, scale = many ? Math.min(1, 4.6 / Math.max(4.6, cols * 1.1)) * 1 : 1;
  const floorMat = own(new THREE.MeshStandardMaterial({ color: 0xf4ead2, roughness: .9 })), ringMat = own(new THREE.MeshStandardMaterial({ color: 0xd98b5f, roughness: .8 }));
  const floor = many
    ? new THREE.Mesh(own(new RoundedBoxGeometry(cols * stepX + .8, .12, rows * stepZ + .6, 3, .06)), floorMat)
    : new THREE.Mesh(own(new THREE.CylinderGeometry(2.1, 2.1, .12, 56)), floorMat);
  floor.position.y = -.06; scene.add(floor);
  if (!many) { const ring = new THREE.Mesh(own(new THREE.TorusGeometry(1.95, .035, 8, 64)), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = .002; scene.add(ring); }

  const slots: Slot[] = parcels.map((parcel, index) => {
    const { tape, filler, sticker } = parcel.packaging, shelf = shelfColour(parcel.product);
    const group = new THREE.Group(), cardboard = (colour: number, lift = 0) => own(new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).lerp(new THREE.Color(0xffffff), lift), roughness: .85 }));
    const bodyMat = cardboard(new THREE.Color(shelf).getHex()), flapMat = cardboard(new THREE.Color(shelf).getHex(), .18), tapeMat = own(new THREE.MeshStandardMaterial({ color: TAPE[tape], roughness: .5, transparent: true }));
    const body = new THREE.Mesh(bodyGeo, bodyMat); body.position.y = H / 2; group.add(body);
    const inside = new THREE.Mesh(insideGeo, insideMat); inside.rotation.x = -Math.PI / 2; inside.position.y = H + .004; group.add(inside);
    const flaps: Flap[] = [];
    const hinge = (geo: THREE.BufferGeometry, axis: 'x' | 'z', sign: number, at: [number, number, number], offset: [number, number, number], lift: number, max: number, delay: number) => {
      const pivot = new THREE.Group(); pivot.position.set(at[0], H + .03 + lift, at[2]);
      const mesh = new THREE.Mesh(geo, flapMat); mesh.position.set(...offset); pivot.add(mesh); group.add(pivot); flaps.push({ pivot, axis, sign, max, delay });
    };
    hinge(minorGeo, 'z', 1, [-W / 2, 0, 0], [D / 4, 0, 0], 0, 1.75, .06);
    hinge(minorGeo, 'z', -1, [W / 2, 0, 0], [-D / 4, 0, 0], 0, 1.75, .09);
    hinge(majorGeo, 'x', 1, [0, 0, D / 2], [0, 0, -D / 4], .06, 2.0, 0);
    hinge(majorGeo, 'x', -1, [0, 0, -D / 2], [0, 0, D / 4], .06, 2.0, .03);
    const tapes = [-1, 1].map(side => { const m = new THREE.Mesh(tapeGeo, tapeMat); m.position.set(side * (W + .12) / 4, H + .13, 0); group.add(m); return m; });
    const face = own(cardFace(parcel.product, options.loadImage, 2));
    const label = new THREE.Mesh(labelGeo, own(new THREE.MeshBasicMaterial({ map: face.texture, toneMapped: false }))); label.position.set(0, H * .47, D / 2 + .004); group.add(label);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.rotation.x = -Math.PI / 2; shadow.scale.set(W * 1.9, D * 2.2, 1); shadow.position.y = .004; group.add(shadow);

    const count = many ? 30 : 56, random = rand(index * 7919 + 13);
    const piece: THREE.BufferGeometry = filler === 'bubble' ? own(new THREE.SphereGeometry(.075, 10, 8)) : filler === 'peanuts' ? own(new THREE.CapsuleGeometry(.03, .09, 3, 6)) : filler === 'tissue' ? own(new THREE.PlaneGeometry(.26, .26)) : filler === 'confetti' ? own(new THREE.PlaneGeometry(.07, .12)) : own(new THREE.BoxGeometry(.2, .012, .035));
    const fillerMat = own(new THREE.MeshStandardMaterial({ color: filler === 'bubble' ? 0xbcdcee : filler === 'peanuts' ? 0xf6ecd0 : filler === 'tissue' ? 0xf7c2d6 : filler === 'confetti' ? 0xffffff : 0xe8d2a4, roughness: .7, side: THREE.DoubleSide, transparent: filler === 'bubble', opacity: filler === 'bubble' ? .75 : 1 }));
    const mesh = new THREE.InstancedMesh(piece, fillerMat, count); mesh.visible = false; mesh.frustumCulled = false; group.add(mesh);
    const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3), rot = new Float32Array(count * 3), spin = new Float32Array(count * 3), dummy = new THREE.Object3D(), tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      pos.set([(random() - .5) * (W - .4), H + .02 + random() * .1, (random() - .5) * (D - .4)], i * 3);
      vel.set([(random() - .5) * 1.4, 2.6 + random() * 2.2, (random() - .5) * 1.4], i * 3);
      rot.set([random() * 6, random() * 6, random() * 6], i * 3); spin.set([(random() - .5) * 9, (random() - .5) * 9, (random() - .5) * 9], i * 3);
      if (filler === 'confetti') mesh.setColorAt(i, tint.set(['#e0605a', '#3f9d9a', '#f2c14e', '#8fb4d4', '#c9a8e8'][i % 5]));
    }
    const fl = { mesh, pos, vel, launched: false, update(dt: number, t: number) {
      if (!fl.launched) return;
      const fade = clamp01(1 - (t - 2.2) / .5);
      for (let i = 0; i < count; i++) {
        const k = i * 3; vel[k + 1] -= 9 * dt; pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
        const inBox = Math.abs(pos[k]) < W / 2 - .1 && Math.abs(pos[k + 2]) < D / 2 - .1, floorY = inBox ? H + .03 : .04;
        if (pos[k + 1] < floorY && vel[k + 1] < 0) { pos[k + 1] = floorY; vel[k] *= .3; vel[k + 1] = 0; vel[k + 2] *= .3; spin[k] = spin[k + 1] = spin[k + 2] = 0; }
        rot[k] += spin[k] * dt; rot[k + 1] += spin[k + 1] * dt; rot[k + 2] += spin[k + 2] * dt;
        dummy.position.set(pos[k], pos[k + 1], pos[k + 2]); dummy.rotation.set(rot[k], rot[k + 1], rot[k + 2]); dummy.scale.setScalar(fade); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    } };
    for (let i = 0; i < count; i++) { dummy.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); dummy.rotation.set(rot[i * 3], rot[i * 3 + 1], rot[i * 3 + 2]); dummy.scale.setScalar(1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); }
    const rarity = rarityOf(parcel.packaging), origin = new THREE.Vector3(many ? ((index % cols) - (cols - 1) / 2) * stepX : 0, 0, many ? (Math.floor(index / cols) - (rows - 1) / 2) * stepZ : 0);
    group.position.copy(origin); group.scale.setScalar(scale); scene.add(group);
    void sticker;
    return { parcel, index, group, body: bodyMat, flaps, tape: tapes, tapeMat, filler: fl, rare: rarity === 'rare', fine: rarity === 'fine', opened: null, shaking: false, origin, scale } satisfies Slot;
  });

  // The parcels are framed in the host box, but the canvas covers the window so bursts and the outer parcels spill past it.
  const fit = () => {
    // Sizes come from layout and the centre from the rect, so an entrance scale on the host does not shrink the framing.
    const frame = host.getBoundingClientRect(), w = host.clientWidth || 1, h = host.clientHeight || 1, W = innerWidth, H = innerHeight;
    const cx = frame.left + frame.width / 2, cy = frame.top + frame.height / 2;
    renderer.setSize(W, H, false);
    Object.assign(renderer.domElement.style, { left: `${w / 2 - cx}px`, top: `${h / 2 - cy}px`, width: `${W}px`, height: `${H}px` });
    camera.aspect = w / h;
    const halfW = many ? (cols * stepX + .8) / 2 : 2.15, halfH = many ? (rows * stepZ + 2.4) / 2 : 2.0, t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(halfW / (t * camera.aspect), halfH / t) * 1.08 + (rows * stepZ + .6) / 2, target = many ? new THREE.Vector3(0, .9, 0) : new THREE.Vector3(0, 1.25, 0);
    camera.position.set(0, target.y + dist * .36, dist * .93); camera.lookAt(target); camera.updateProjectionMatrix();
    const px = 2 * camera.near * t / h;
    camera.projectionMatrix.makePerspective(-cx * px, (W - cx) * px, cy * px, (cy - H) * px, camera.near, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
  fit();
  const observer = new ResizeObserver(fit); observer.observe(host); addEventListener('resize', fit);

  const CARD = 1.5;
  const revealCard = (slot: Slot) => {
    const face = cardFace(slot.parcel.product, options.loadImage, 3), h = CARD / face.aspect;
    const frame = new THREE.MeshStandardMaterial({ color: slot.rare ? GOLD : slot.fine ? 0xf4b9c9 : 0xfffaf0, roughness: .35, metalness: slot.rare ? .45 : 0, emissive: slot.rare ? 0x6b4a00 : 0x000000 });
    const back = new THREE.MeshStandardMaterial({ color: shelfColour(slot.parcel.product), roughness: .6 }), front = new THREE.MeshBasicMaterial({ map: face.texture, toneMapped: false, transparent: true });
    const bodyGeo = new RoundedBoxGeometry(CARD + .12, h + .12, .04, 2, .03), faceGeo = new THREE.PlaneGeometry(CARD, h);
    const node = new THREE.Group(), card = new THREE.Group(); card.position.y = h / 2 + .06; node.add(card);
    card.add(new THREE.Mesh(bodyGeo, frame));
    const shown = new THREE.Mesh(faceGeo, front); shown.position.z = .021; card.add(shown);
    const behind = new THREE.Mesh(faceGeo, back); behind.position.z = -.021; behind.rotation.y = Math.PI; card.add(behind);
    card.rotation.x = -.18;
    return { node, dispose() { face.dispose(); [frame, back, front].forEach(m => m.dispose()); bodyGeo.dispose(); faceGeo.dispose(); } };
  };

  const sparkCount = 46;
  const startBurst = (slot: Slot) => {
    const gold = slot.rare, big = gold ? 1.5 : slot.fine ? 1.15 : 1, y = many ? H + 1.2 : H + 1.7, at = slot.origin.clone().setY(y * slot.scale);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: gold ? goldTex : flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    const rays = new THREE.Mesh(raysGeo, new THREE.MeshBasicMaterial({ map: gold ? goldRaysTex : raysTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, side: THREE.DoubleSide }));
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: goldTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    const geo = new THREE.BufferGeometry(), random = rand(slot.index * 31 + 5), dirs = new Float32Array(sparkCount * 3), start = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) { const a = random() * Math.PI * 2, e = (random() - .3) * 1.4; dirs.set([Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e) * .5], i * 3); }
    geo.setAttribute('position', new THREE.BufferAttribute(start, 3));
    const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ map: flashTex, size: gold ? .22 : .16, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: gold ? GOLD : 0xfff3b8, opacity: 0 }));
    for (const part of [flash, rays, aura, sparks]) { part.position.copy(at); part.userData.big = big; scene.add(part); }
    rays.position.z -= .6; flash.position.z -= .1; aura.position.z -= .3;
    slot.burst = { flash, rays, sparks, dirs, aura };
    disposables.push(geo, flash.material, rays.material, aura.material, sparks.material);
  };

  let disposed = false, frame = 0, last = performance.now() / 1000;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), spinQ = new THREE.Quaternion();
  const setFade = (node: THREE.Object3D, alpha: number) => node.traverse(part => { const mesh = part as THREE.Mesh; if (!mesh.isMesh) return; for (const m of [mesh.material].flat()) { const mat = m as THREE.Material & { opacity: number }; mat.transparent = alpha < 1; mat.opacity = alpha; } });

  const update = (now: number, dt: number) => {
    let flareLevel = 0;
    for (const slot of slots) {
      const { group, origin } = slot;
      if (slot.shaking && slot.opened === null && !reduced) {
        group.position.set(origin.x + Math.sin(now * 62) * .03, 0, origin.z); group.rotation.z = Math.sin(now * 51) * .045;
        if (slot.rare) slot.body.emissive.setHex(0x6b4a00).multiplyScalar(.5 + .5 * Math.sin(now * 14));
      } else { group.position.copy(origin); group.rotation.z = 0; }
      if (slot.opened === null) continue;
      const t = now - slot.opened;
      if (!reduced) {
        const peel = clamp01(t / .35);
        slot.tape.forEach((m, i) => { m.position.x = (i ? 1 : -1) * ((W + .12) / 4 + peel * .9); m.position.y = H + .13 + peel * .25; m.rotation.z = (i ? -1 : 1) * peel * .9; });
        slot.tapeMat.opacity = 1 - ease.in(peel);
        for (const f of slot.flaps) f.pivot.rotation[f.axis] = f.sign * f.max * spring((t - T_FLAPS - f.delay) / .75);
        const u = clamp01(t / .9), k = .09 * Math.sin(u * Math.PI * 2) * Math.exp(-3 * u);
        group.scale.set(slot.scale * (1 + k * .5), slot.scale * (1 - k), slot.scale * (1 + k * .5));
      } else {
        slot.tapeMat.opacity = 0; for (const f of slot.flaps) f.pivot.rotation[f.axis] = f.sign * f.max;
      }
      slot.body.emissive.setHex(0x000000);
      if (!slot.filler.launched && t > T_FLAPS + .1 && !reduced) { slot.filler.launched = true; slot.filler.mesh.visible = true; }
      slot.filler.update(dt, t);

      const p = slot.product, b = slot.burst;
      if (b && !reduced) {
        const bt = t - .3, big = b.flash.userData.big as number, life = slot.rare ? 2.2 : 1.4;
        const alpha = bt < 0 ? 0 : clamp01(1 - bt / life);
        (b.flash.material as THREE.SpriteMaterial).opacity = bt < 0 ? 0 : clamp01(1 - bt / (slot.rare ? 1.3 : .7));
        b.flash.scale.setScalar(many ? 2.2 * big * (.3 + bt) : 3.2 * big * (.3 + bt));
        (b.rays.material as THREE.MeshBasicMaterial).opacity = alpha * .9;
        b.rays.scale.setScalar((many ? 2.8 : 3.2) * big * (.4 + Math.min(bt, 1) * .8));
        b.rays.quaternion.copy(camera.quaternion).multiply(spinQ.setFromAxisAngle(tmp2.set(0, 0, 1), bt * .5));
        const sm = b.sparks.material as THREE.PointsMaterial; sm.opacity = alpha;
        const attr = b.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < sparkCount; i++) { const r = Math.max(0, bt) * (many ? 1.6 : 2.6) * big * (.5 + (i % 5) * .22); attr.setXYZ(i, b.dirs[i * 3] * r, b.dirs[i * 3 + 1] * r - Math.max(0, bt) ** 2 * .5, b.dirs[i * 3 + 2] * r); }
        attr.needsUpdate = true; b.sparks.position.copy(b.flash.position).setZ(b.flash.position.z + .1);
        const aura = b.aura.material as THREE.SpriteMaterial; aura.opacity = slot.rare ? clamp01((t - T_RISE) / .6) * .85 * (t > T_FLY ? clamp01(1 - (t - T_FLY) / .6) : 1) : 0;
        if (p) { b.aura.position.copy(p.node.position).setZ(p.node.position.z - .4); b.aura.scale.setScalar(many ? 2.4 : 4.2 + Math.sin(now * 4) * .2); }
        if (slot.rare) flareLevel = Math.max(flareLevel, (1 - clamp01(bt / life)) * 14);
      }
      if (p) {
        const rise = many ? 1.15 : 1.75, u = clamp01((t - T_RISE) / RISE_S), e = ease.out(u), y = (H * .5 + rise * e) * slot.scale;
        p.node.position.set(origin.x, y, origin.z);
        p.node.scale.setScalar(slot.scale * (reduced ? 1 : .45 + .55 * e) * (many ? .62 : 1));
        p.node.rotation.y = reduced ? 0 : (u < 1 ? (Math.PI * 2 * e) : Math.sin(now * 1.3) * .25);
        p.node.visible = t > T_RISE - .05;
        if (reduced) setFade(p.node, clamp01((t - T_RISE) / .5));
        if (!many && !reduced && t > T_FLY) {
          const shelf = options.shelf?.(), canvas = renderer.domElement.getBoundingClientRect(), f = ease.in(clamp01((t - T_FLY) / (T_END - T_FLY)));
          if (shelf?.width && canvas.width) {
            const ndc = new THREE.Vector2(((shelf.left + shelf.width / 2 - canvas.left) / canvas.width) * 2 - 1, -(((shelf.top + shelf.height / 2 - canvas.top) / canvas.height) * 2 - 1));
            tmp.set(ndc.x, ndc.y, .5).unproject(camera).sub(camera.position).normalize();
            const dist = camera.position.distanceTo(p.node.position); tmp.multiplyScalar(dist).add(camera.position);
            p.node.position.lerp(tmp, f);
          } else p.node.position.y += f * 2;
          p.node.scale.multiplyScalar(1 - f * .78);
        }
      }
    }
    flare.intensity = flareLevel;
  };

  const loop = () => {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    const now = performance.now() / 1000, dt = Math.min(.05, now - last); last = now;
    update(now, dt); renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return {
    open(index) {
      const slot = slots[index]; if (!slot || slot.opened !== null) return;
      slot.opened = performance.now() / 1000; slot.shaking = false;
      slot.filler.mesh.visible = !reduced;
      const built = revealCard(slot); built.node.visible = false; scene.add(built.node); slot.product = { built, node: built.node };
      if (reduced) setFade(built.node, 0);
      if (!reduced) startBurst(slot);
    },
    shake(index) { slots.forEach(slot => { slot.shaking = slot.index === index; }); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); removeEventListener('resize', fit);
      for (const slot of slots) slot.product?.built.dispose();
      disposables.forEach(item => item.dispose());
      renderer.dispose(); try { renderer.forceContextLoss(); } catch {}
      renderer.domElement.remove();
    },
  };
}

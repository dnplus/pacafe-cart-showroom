import * as THREE from 'three';
import { cardYaw } from './sprites';
import type { Vec } from './behavior';

const RESIDENT_HEIGHT = 2.1;
const SINK = .055;

interface Bounds { l: number; t: number; r: number; b: number }
export interface Layout { cols: number; rows: number; crop: Bounds; foot: number; middle: number; cellAspect: number; cellPx: number; unit: number; pixel: boolean }
interface Measured { union: Bounds; idle: Bounds; pixel: boolean }

export function measureImage(image: CanvasImageSource & { width: number; height: number }, cols: number, rows: number, idleCells: [number, number][], drawn = rows): Measured | null {
  const { width: w, height: h } = image; const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  let data: Uint8ClampedArray; try { data = ctx.getImageData(0, 0, w, h).data; } catch { return null; }
  const cw = Math.floor(w / cols), ch = Math.floor(h / rows);
  const cell = (col: number, row: number): Bounds | null => {
    let l = cw, t = ch, r = -1, b = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (data[((row * ch + y) * w + col * cw + x) * 4 + 3] > 24) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
    return r < 0 ? null : { l: l / cw, t: t / ch, r: (r + 1) / cw, b: (b + 1) / ch };
  };
  const join = (list: (Bounds | null)[]) => list.reduce<Bounds | null>((all, next) => !next ? all : !all ? next : { l: Math.min(all.l, next.l), t: Math.min(all.t, next.t), r: Math.max(all.r, next.r), b: Math.max(all.b, next.b) }, null);
  const union = join(Array.from({ length: cols * drawn }, (_, i) => cell(i % cols, Math.floor(i / cols))));
  const idle = join(idleCells.map(([col, row]) => cell(col, row)));
  if (!union || !idle) return null;
  const colours = new Set<number>(); let solid = 0, soft = 0;
  for (const [col, row] of idleCells) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = ((row * ch + y) * w + col * cw + x) * 4; const a = data[i + 3];
    if (a > 240) { solid++; if (colours.size < 64) colours.add(data[i] << 16 | data[i + 1] << 8 | data[i + 2]); } else if (a > 24) soft++;
  }
  return { union, idle, pixel: solid > 40 && soft / solid < .03 && colours.size < 48 };
}

export function sheetLayout(measured: Measured, imageHeight: number, rows: number): Layout {
  const { union, idle, pixel } = measured;
  return { cols: 8, rows, crop: union, foot: idle.b, middle: (idle.l + idle.r) / 2, cellAspect: 1, cellPx: imageHeight / rows, unit: RESIDENT_HEIGHT / Math.max(.05, idle.b - idle.t), pixel };
}
export function singleLayout(measured: Measured | null, width: number, height: number, target = RESIDENT_HEIGHT): Layout {
  const crop = measured?.union ?? { l: 0, t: 0, r: 1, b: 1 };
  return { cols: 1, rows: 1, crop, foot: crop.b, middle: (crop.l + crop.r) / 2, cellAspect: width / height, cellPx: height, unit: target / Math.max(.05, crop.b - crop.t), pixel: measured?.pixel ?? false };
}

export function frameOf(layout: Layout) {
  const px = 2 / (layout.cellPx * layout.cellAspect), py = 2 / layout.cellPx;
  const l = layout.crop.l - px, r = layout.crop.r + px, t = layout.crop.t - py, b = layout.crop.b + py;
  const width = (r - l) * layout.cellAspect * layout.unit, height = (b - t) * layout.unit;
  const center = new THREE.Vector2((layout.middle - l) / (r - l), ((b - layout.foot) * layout.unit + SINK) / height);
  return { l, r, t, b, width, height, center, top: height * (1 - center.y) };
}

export type StandeeUniforms = ReturnType<typeof standeeUniforms>;
const standeeUniforms = () => ({ frame: { value: new THREE.Vector4(0, 0, 1, 1) }, tint: { value: new THREE.Color(1, 1, 1) }, sheen: { value: 0 }, dim: { value: 0 } });

const plane = new THREE.PlaneGeometry(1, 1);
/**
 * Every card shares one plane, and each renderer that draws it hangs a dispose listener on it that holds that renderer's buffers.
 * A room that closes lets go of the plane this way, or the plane keeps every closed room's canvas alive; open rooms upload it again.
 */
export const releaseCardPlane = () => plane.dispose();
const turn = new THREE.Matrix4(), tilt = new THREE.Matrix4(), stretch = new THREE.Matrix4(), anchor = new THREE.Matrix4();
export class Card extends THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  readonly center = new THREE.Vector2(.5, .5); lean = 0; flip = 1; yaw = 0;
  constructor(material: THREE.MeshBasicMaterial) { super(plane, material); }
  override updateMatrix() {
    turn.makeRotationY(this.yaw); tilt.makeRotationZ(this.lean); stretch.makeScale(this.scale.x * this.flip, this.scale.y, 1);
    anchor.makeTranslation(.5 - this.center.x, .5 - this.center.y, 0);
    this.matrix.makeTranslation(this.position.x, this.position.y, this.position.z).multiply(turn).multiply(tilt).multiply(stretch).multiply(anchor);
    this.matrixWorldNeedsUpdate = true;
  }
}
const looking = new THREE.Vector3();
export function cameraView(camera: THREE.Camera): Vec { camera.getWorldDirection(looking); return { x: -looking.x, z: -looking.z }; }
export function orientCard(card: Card, view: Vec, ease = 1) {
  const gap = Math.atan2(Math.sin(cardYaw(view) - card.yaw), Math.cos(cardYaw(view) - card.yaw));
  card.yaw = ease >= 1 || Math.abs(gap) < 1e-3 ? cardYaw(view) : card.yaw + gap * ease;
}

export function standeeMaterial() {
  const uniforms = standeeUniforms();
  const material = new THREE.MeshBasicMaterial({ alphaTest: .12, alphaToCoverage: true, depthTest: true, depthWrite: true, toneMapped: false, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vQuad;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvQuad = uv;');
    shader.fragmentShader = shader.fragmentShader.replace('uniform float opacity;', `uniform float opacity;
uniform vec4 frame;
uniform vec3 tint;
uniform float sheen;
uniform float dim;
varying vec2 vQuad;
float inFrame( vec2 p ) { return step( frame.x, p.x ) * step( p.x, frame.z ) * step( frame.y, p.y ) * step( p.y, frame.w ); }`)
      .replace('#include <map_fragment>', `vec4 art = texture2D( map, vMapUv );
	art.a *= inFrame( vMapUv );
	vec3 colour = art.rgb / max( art.a, 1e-4 );
	float sweep = fract( ( vQuad.x * 0.55 + vQuad.y * 0.85 ) * 0.5 - sheen );
	colour += ( 1.0 - smoothstep( 0.0, 0.035, abs( sweep - 0.5 ) ) ) * 0.06 * ( 1.0 - dim );
	colour = mix( colour, vec3( dot( colour, vec3( 0.299, 0.587, 0.114 ) ) ) * vec3( 0.93, 0.95, 1.0 ), dim * 0.75 ) * ( 1.0 - dim * 0.22 );
	diffuseColor *= vec4( colour * tint, art.a );`);
  };
  return { material, uniforms };
}

/** Illustrations need minification filtering. Isolate one cell first so its mipmaps never mix in the next pose or facing. */
export function illustrationFrame(image: CanvasImageSource & { width: number; height: number }, cols: number, rows: number, col: number, row: number): THREE.CanvasTexture | null {
  const width = Math.floor(image.width / cols), height = Math.floor(image.height / rows);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  ctx.drawImage(image, col * width, row * height, width, height, 0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.isolatedFrame = true;
  return texture;
}

export function dress(map: THREE.Texture, uniforms: StandeeUniforms, layout: Layout, col: number, row: number) {
  const f = frameOf(layout);
  const filter = layout.pixel ? THREE.NearestFilter : THREE.LinearFilter;
  const mipmaps = !layout.pixel && map.userData.isolatedFrame === true;
  const minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : filter;
  if (map.generateMipmaps !== mipmaps || map.minFilter !== minFilter || map.magFilter !== filter || !map.premultiplyAlpha) {
    map.generateMipmaps = mipmaps; map.minFilter = minFilter; map.magFilter = filter; map.premultiplyAlpha = true; map.needsUpdate = true;
  }
  map.repeat.set((f.r - f.l) / layout.cols, (f.b - f.t) / layout.rows);
  map.offset.set((col + f.l) / layout.cols, 1 - (row + f.b) / layout.rows);
  const hx = .5 / (layout.cellPx * layout.cellAspect * layout.cols), hy = .5 / (layout.cellPx * layout.rows);
  uniforms.frame.value.set(col / layout.cols + hx, 1 - (row + 1) / layout.rows + hy, (col + 1) / layout.cols - hx, 1 - row / layout.rows - hy);
}

export function acrylicTexture() {
  const size = 256; const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; const ctx = canvas.getContext('2d')!;
  const c = size / 2, r = c - 8;
  ctx.fillStyle = '#5a463420'; ctx.beginPath(); ctx.arc(c, c + 5, r, 0, Math.PI * 2); ctx.fill();
  const fill = ctx.createRadialGradient(c, c, 8, c, c, r); fill.addColorStop(0, '#ffffff38'); fill.addColorStop(.8, '#f4fbff66'); fill.addColorStop(1, '#ffffffa0');
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6e5a4640'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#ffffffe8'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(c, c, r - 7, Math.PI * .12, Math.PI * .88); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(c, c, r - 20, Math.PI * 1.15, Math.PI * 1.4); ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

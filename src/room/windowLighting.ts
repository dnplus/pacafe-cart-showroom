import * as THREE from 'three';
import { pieces, type Item } from './pieces';
import { roomFloor } from '../../shared/room-dimensions';
import type { Daylight } from './daylight';

const windowKinds: ReadonlySet<string> = new Set([
  'collect_coralie_s06_draped_window',
  'collect_terra_window_casement',
  'collect_terra_window_arch',
  'collect_terra_window_panorama',
  'collect_terra_window_shutter',
]);
export const isWindowFurniture = (kind: string) => windowKinds.has(kind);

export const windowLightFloor = .236;
export interface WindowAnchor {
  id: string;
  kind?: string;
  position: [number, number, number];
  inward: [number, number, number];
  width: number;
  height: number;
  source?: THREE.Object3D;
}
interface WindowProjectionVertex { x: number; z: number; u: number; v: number }

export function placedWindows(live: Iterable<{ item: Pick<Item, 'id' | 'kind' | 'stowed'>; node: THREE.Object3D }>): WindowAnchor[] {
  const windows: WindowAnchor[] = [];
  for (const { item, node } of live) {
    if (item.stowed || !isWindowFurniture(item.kind)) continue;
    node.updateWorldMatrix(true, false);
    const { width, height } = pieces[item.kind].hang!;
    windows.push({ id: item.id, kind: item.kind, position: node.getWorldPosition(new THREE.Vector3()).toArray(), inward: new THREE.Vector3(0, 0, 1).transformDirection(node.matrixWorld).toArray(), width, height, source: node });
  }
  return windows;
}

const blend = (from: string, to: string, amount: number) => `#${new THREE.Color(from).lerp(new THREE.Color(to), amount).getHexString()}`;
const dayAmount = (d: Daylight) => Math.max(0, Math.min(1, (d.sunIntensity - .6) / 2.3));
function incoming(d: Daylight, window: WindowAnchor, direction?: THREE.Vector3) {
  const ray = direction?.clone().normalize() ?? new THREE.Vector3(...d.sunAt).negate().normalize();
  const incidence = Math.max(0, ray.x * window.inward[0] + ray.z * window.inward[2]);
  return { ray, incidence };
}
function clip(vertices: WindowProjectionVertex[], axis: 'x' | 'z', boundary: number, sign: number) {
  const out: WindowProjectionVertex[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const insideA = (a[axis] - boundary) * sign >= 0, insideB = (b[axis] - boundary) * sign >= 0;
    if (insideA) out.push(a);
    if (insideA !== insideB) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return out;
}

export function windowPatch(window: WindowAnchor, d: Daylight, direction?: THREE.Vector3) {
  const { ray, incidence } = incoming(d, window, direction);
  const amount = dayAmount(d);
  if (amount === 0 || incoming(d, window).incidence <= 0 || incidence <= 0 || ray.y >= -.05) return { vertices: [], opacity: 0 };
  const tangent = new THREE.Vector3(window.inward[2], 0, -window.inward[0]).normalize();
  let vertices = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const corner = new THREE.Vector3(...window.position).addScaledVector(tangent, (u - .5) * window.width);
    corner.y += (v - .5) * window.height;
    const distance = (windowLightFloor - corner.y) / ray.y;
    return { x: corner.x + ray.x * distance, z: corner.z + ray.z * distance, u, v };
  });
  for (const [axis, boundary, sign] of [['x', roomFloor.minX + .18, 1], ['x', roomFloor.maxX - .18, -1], ['z', roomFloor.minZ + .18, 1], ['z', roomFloor.maxZ - .18, -1]] as const) vertices = clip(vertices, axis, boundary, sign);
  return { vertices, opacity: vertices.length < 3 ? 0 : amount * incidence * .15 };
}

export function windowLighting(d: Daylight, windows: readonly WindowAnchor[], brightness = 1) {
  let total = 0;
  const center = new THREE.Vector3();
  for (const window of windows) {
    const { incidence } = incoming(d, window);
    center.addScaledVector(new THREE.Vector3(...window.position), incidence); total += incidence;
  }
  if (total > 0) center.divideScalar(total);
  const amount = windows.length ? dayAmount(d) * Math.min(1, total / windows.length / .6) : 0;
  const ray = new THREE.Vector3(...d.sunAt).negate().normalize();
  const position = new THREE.Vector3(-2, 9, 3).lerp(center.clone().addScaledVector(ray, -12), amount).toArray();
  const target = new THREE.Vector3().lerp(center.clone().addScaledVector(ray, 5), amount).toArray();
  return {
    amount, position, target,
    key: blend('#ffd7a4', d.sun, amount),
    keyIntensity: .95 * brightness * (1 - amount) + d.sunIntensity * amount,
    sky: blend('#ffe6c8', d.sky, amount),
    ground: '#8a705b', hemi: (.85 + amount * .16) * brightness,
    fill: blend('#ffe1bd', d.fill, amount), fillIntensity: (.38 + amount * .12) * brightness,
    environment: (.20 + amount * .06) * brightness,
  };
}

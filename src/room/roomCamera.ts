import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { roomFloor, roomWalls } from '../../shared/room-dimensions.ts';

const { minX, maxX, minZ, maxZ } = roomFloor;
const roomBounds = [
  ...[minX - .05, maxX + .05].flatMap(x => [minZ - .05, maxZ + .05].flatMap(z => [-.46, .18].map(y => new Vector3(x, y, z)))),
  new Vector3(minX, roomWalls.top, minZ - .05), new Vector3(maxX, roomWalls.top, minZ - .05), new Vector3(minX, roomWalls.top, maxZ),
];
// Low enough that the taller square room still fits a 1200×630 share-card crop of a 1440×900 view.
const maxRoomPixelsPerUnit = 54;
// The square room frames smaller on phones, so close-ups may zoom further than the old 3×.
const maxRoomZoom = 3.5;
export const clampRoomZoom = (zoom: number) => Math.max(1, Math.min(maxRoomZoom, zoom));
export const minRoomAngle = -.3;
export const maxRoomAngle = .5;
export const clampRoomAngle = (angle: number) => Math.max(minRoomAngle, Math.min(maxRoomAngle, angle));
export const roomFov = 24;
const MARGIN = 1.06;
const centre = new Box3().setFromPoints(roomBounds).getCenter(new Vector3());

interface RoomView { target: Vector3; halfW: number; halfH: number }

export function frameRoom(camera: PerspectiveCamera, width: number, height: number, angle = 0): RoomView | null {
  if (width <= 0 || height <= 0) return null;
  camera.zoom = 1; camera.fov = roomFov; camera.aspect = width / height; camera.near = .5; camera.far = 400; camera.updateProjectionMatrix();
  const yaw = Math.PI / 4 + clampRoomAngle(angle);
  const direction = new Vector3(Math.sin(yaw), 1 / Math.sqrt(3), Math.cos(yaw)).normalize();
  const tan = Math.tan(roomFov * Math.PI / 360);
  const target = centre.clone();
  const place = (distance: number) => { camera.position.copy(target).addScaledVector(direction, distance); camera.lookAt(target); camera.updateMatrixWorld(); };
  const projected = () => roomBounds.map(point => point.clone().project(camera));
  let distance = 40;
  for (let pass = 0; pass < 3; pass++) {
    let near = 4, far = 400;
    for (let step = 0; step < 40; step++) {
      const mid = (near + far) / 2; place(mid);
      if (projected().every(p => Math.abs(p.x) * MARGIN <= 1 && Math.abs(p.y) * MARGIN <= 1)) far = mid; else near = mid;
    }
    distance = Math.max(far, height / maxRoomPixelsPerUnit / 2 / tan); place(distance);
    const points = projected(); const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, cx * distance * tan * camera.aspect).addScaledVector(up, cy * distance * tan);
  }
  place(distance);
  return { target, halfW: distance * tan * camera.aspect, halfH: distance * tan };
}

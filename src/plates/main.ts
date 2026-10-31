import * as THREE from 'three';
import { floorTop } from '../../shared/room-dimensions';
import { STUDIO_SET_SPOT } from '../../shared/studio';
import { defaultFurniture } from '../room/furniture';
import { buildRoom, type RoomDebugApi } from '../room/roomModel';
import { Card } from '../room/standee';
import { hostPlace, showroomStudioSet } from '../room/studioSet';

/** Page for scripts/promo-plates.mjs. Vite serves it in development only; the app's build never includes it. */
const DESK = ['host_desk', 'host_monitor', 'host_desktop_microphone', 'host_coffee_mug', 'host_desk_plant'];
export const SHOTS = { wide: { zoom: 1, toward: .35, side: 0 }, close: { zoom: 1.4, toward: 0, side: .75 } } as const;

const host = document.getElementById('room') as HTMLDivElement;
let api: RoomDebugApi | undefined;
const ready = new Promise<void>((resolve, reject) => {
  const room = buildRoom(host, () => {}, () => resolve(), () => reject(new Error('no WebGL')), { studioSet: showroomStudioSet, furniture: [...defaultFurniture], debug: value => { api = value; } });
  room.furniture([...defaultFurniture]); room.update('peach');
  (window as unknown as { plateRoom: typeof room }).plateRoom = room;
});

function shoot(name: keyof typeof SHOTS) {
  const room = (window as unknown as { plateRoom: ReturnType<typeof buildRoom> }).plateRoom;
  room.present?.(STUDIO_SET_SPOT); room.shoot?.(SHOTS[name]);
  const { scene, camera, renderer } = api!;
  camera.position.x += SHOTS[name].side; camera.updateMatrixWorld();
  const hidden: THREE.Object3D[] = [];
  scene.traverse(node => { if ((node instanceof Card || node instanceof THREE.Sprite) && node.visible) { node.visible = false; hidden.push(node); } });
  const frame = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); };
  const back = frame();
  const desk = new Set<THREE.Object3D>();
  for (const name of DESK) scene.getObjectByName(name)?.traverse(node => desk.add(node));
  const keep = new Set<THREE.Object3D>(desk);
  for (const node of desk) node.traverseAncestors(parent => keep.add(parent));
  const toggled: THREE.Object3D[] = [];
  scene.traverse(node => { if (node.visible && !keep.has(node) && (node as THREE.Mesh).isMesh) { node.visible = false; toggled.push(node); } });
  const background = scene.background; scene.background = null;
  const clear = renderer.getClearAlpha(); renderer.setClearAlpha(0);
  const front = frame();
  renderer.setClearAlpha(clear); scene.background = background;
  toggled.forEach(node => { node.visible = true; }); hidden.forEach(node => { node.visible = true; });
  const seat = hostPlace(STUDIO_SET_SPOT, showroomStudioSet)!.seat!;
  const px = (y: number) => { const p = new THREE.Vector3(seat.x, y, seat.z).project(camera); return { x: (p.x + 1) / 2 * host.clientWidth, y: (1 - p.y) / 2 * host.clientHeight }; };
  const feet = px(floorTop), metre = px(floorTop + 1);
  return { back, front, feet, pxPerMetre: feet.y - metre.y };
}

(window as unknown as { plates: () => Promise<unknown> }).plates = async () => {
  await ready;
  await new Promise<void>(resolve => { const look = () => host.dataset.studioSet ? resolve() : setTimeout(look, 100); look(); });
  await new Promise(resolve => setTimeout(resolve, 1500));
  return Object.fromEntries((Object.keys(SHOTS) as (keyof typeof SHOTS)[]).map(name => [name, shoot(name)]));
};

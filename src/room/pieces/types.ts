import type * as THREE from 'three';
import type { LampView } from '../lighting';
import type { Locale } from '../../../shared/locales';
import type { Theme } from '../theme';
import type { RoomFurnitureItem, RoomFurnitureKind, RoomTurn, RoomWall } from '../../../shared/room-settings';
import { roomWalls } from '../../../shared/room-dimensions';

export interface Vec { x: number; z: number }
export type SurfaceSize = 'small' | 'appliance';
export interface Footprint { x: number; z: number; rx: number; rz: number; shape: 'ellipse' | 'rect' | 'polygon'; points?: readonly Vec[]; padding?: number }
export type Activity = 'gaze' | 'browse' | 'sip' | 'water' | 'sit' | 'chat';
export type Spot = Vec & { look?: Vec; y?: number };
export interface Poi { id: string; activity: Activity; look: Vec; spots: readonly Spot[] }
export type Wall = RoomWall;
export type Turn = RoomTurn;

export type PieceKind = RoomFurnitureKind;
export type Item = RoomFurnitureItem;

export type Interaction =
  | { type: 'sit'; seat: Spot }
  | { type: 'work'; at: Vec }
  | { type: 'serve'; spot: Spot }
  | { type: 'deliver'; spot: Vec; look: Vec; surface: { x: number; y: number; z: number }[] }
  | { type: 'linger'; id: string; activity: Activity; spots: Spot[]; look: Vec }
  | { type: 'open'; panel: 'energy' | 'counter' | 'notice' }
  | { type: 'poke'; reaction: 'bounce' | 'sway' | 'own' };

export interface RoomState { locale: Locale; theme: Theme; mobile: boolean; board: { lines: string[]; active: boolean; indicators?: string[]; residents?: { name: string; points: number; energy: string }[] }; tint: string;
  notices?: string[] }
export interface PieceView {
  node: THREE.Group;
  refresh?(state: RoomState): void;
  react?(since: number, calm: boolean): void;
  lamp?: LampView;
}

export interface PieceSpec {
  kind: PieceKind;
  variants: readonly string[];
  mount: 'floor' | 'wall' | 'surface';
  footprint: readonly Footprint[];
  hang?: { width: number; height: number; y: number; depth: number; band: 'mid' | 'high' };
  surfaces?(item: Item): { x: number; y: number; z: number; takes?: SurfaceSize; width?: number; depth?: number; slot?: number; rotationY?: number; purpose?: string }[];
  size?: SurfaceSize;
  turns: boolean;
  interactions(item: Item): Interaction[];
}

export function local(item: Pick<Item, 'x' | 'z' | 'turn'>, dx: number, dz: number): Vec {
  const a = item.turn * Math.PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  return { x: item.x + dx * c - dz * s, z: item.z + dx * s + dz * c };
}

export function hangOnWall(node: THREE.Object3D, wall: 'back' | 'left', along: number, hang: { y: number; depth: number }) {
  if (wall === 'back') { node.position.set(along, hang.y, roomWalls.back.z + hang.depth); node.rotation.set(0, 0, 0); }
  else { node.position.set(roomWalls.left.x + hang.depth, hang.y, along); node.rotation.set(0, Math.PI / 2, 0); }
}

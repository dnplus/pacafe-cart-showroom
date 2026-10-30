import { local, type PieceSpec } from './types';
import { insideWalkable, walkableArea } from '../../../shared/room-dimensions';

export const stool: PieceSpec = {
  kind: 'stool', variants: ['round'], mount: 'floor', turns: false,
  footprint: [{ x: 0, z: 0, rx: .22, rz: .22, shape: 'ellipse' }],
  interactions: item => [{ type: 'sit', seat: { x: item.x, z: item.z + .05, look: { x: item.x, z: item.z - 2 } } }, { type: 'poke', reaction: 'bounce' }],
};

export const plant: PieceSpec = {
  kind: 'plant', variants: ['leafy', 'cactus'], mount: 'floor', turns: true,
  footprint: [{ x: 0, z: 0, rx: .4, rz: .4, shape: 'ellipse' }],
  interactions(item) {
    const away = Math.hypot(item.x, item.z) || 1; const reach = .7 + .4 * (item.size ?? 1);
    const spot = { x: Math.max(walkableArea.minX + .2, Math.min(walkableArea.maxX - .2, item.x - item.x / away * reach)), z: Math.max(walkableArea.minZ + .2, Math.min(walkableArea.maxZ - .2, item.z - item.z / away * reach)) };
    return [{ type: 'linger', id: item.id, activity: 'water', spots: [spot], look: { x: item.x, z: item.z } }, { type: 'poke', reaction: 'sway' }];
  },
};

export const signboard: PieceSpec = {
  kind: 'signboard', variants: ['open', 'menu'], mount: 'floor', turns: true,
  footprint: [{ x: 0, z: 0, rx: .38, rz: .28, shape: 'rect' }],
  interactions: item => [
    { type: 'linger', id: item.id, activity: 'gaze', spots: [local(item, 0, 1.1), local(item, 0, -1.1)].filter(insideWalkable), look: { x: item.x, z: item.z } },
    { type: 'poke', reaction: 'bounce' },
  ],
};

export const crate: PieceSpec = {
  kind: 'crate', variants: ['stack', 'single'], mount: 'floor', turns: true,
  footprint: [{ x: 0, z: 0, rx: .42, rz: .36, shape: 'rect' }],
  interactions: () => [{ type: 'poke', reaction: 'bounce' }],
};

export const rug: PieceSpec = {
  kind: 'rug', variants: ['star', 'round'], mount: 'floor', turns: true, footprint: [],
  interactions: () => [],
};

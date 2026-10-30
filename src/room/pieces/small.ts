import type { PieceSpec } from './types';
import { walkableArea } from '../../../shared/room-dimensions';

export const plant: PieceSpec = {
  kind: 'plant', variants: ['leafy', 'cactus'], mount: 'floor', turns: true,
  footprint: [{ x: 0, z: 0, rx: .4, rz: .4, shape: 'ellipse' }],
  interactions(item) {
    const away = Math.hypot(item.x, item.z) || 1; const reach = .7 + .4 * (item.size ?? 1);
    const spot = { x: Math.max(walkableArea.minX + .2, Math.min(walkableArea.maxX - .2, item.x - item.x / away * reach)), z: Math.max(walkableArea.minZ + .2, Math.min(walkableArea.maxZ - .2, item.z - item.z / away * reach)) };
    return [{ type: 'linger', id: item.id, activity: 'water', spots: [spot], look: { x: item.x, z: item.z } }, { type: 'poke', reaction: 'sway' }];
  },
};

export const rug: PieceSpec = {
  kind: 'rug', variants: ['star', 'round'], mount: 'floor', turns: true, footprint: [],
  interactions: () => [],
};

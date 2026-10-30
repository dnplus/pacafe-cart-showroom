import type { PieceSpec } from './types';

export const plant: PieceSpec = {
  kind: 'plant', variants: ['leafy', 'cactus'], mount: 'floor', turns: true,
  interactions: () => [{ type: 'poke', reaction: 'sway' }],
};

export const rug: PieceSpec = {
  kind: 'rug', variants: ['star', 'round'], mount: 'floor', turns: true,
  interactions: () => [],
};

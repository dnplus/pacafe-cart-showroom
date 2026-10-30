import type { PieceSpec } from './types';

export const workBoard: PieceSpec = {
  kind: 'workBoard', variants: ['slate', 'cork'], mount: 'wall', turns: false, footprint: [],
  hang: { width: 3.71, height: 2.58, y: 2.72, depth: .14, band: 'mid' },
  interactions: () => [{ type: 'open', panel: 'energy' }],
};

export const menuBoard: PieceSpec = {
  kind: 'menuBoard', variants: ['chalk', 'cream'], mount: 'wall', turns: false, footprint: [],
  hang: { width: 2.42, height: 1.42, y: 3.05, depth: .07, band: 'mid' },
  interactions: () => [],
};

export const cafeSign: PieceSpec = {
  kind: 'cafeSign', variants: ['plate'], mount: 'wall', turns: false, footprint: [],
  hang: { width: 1.62, height: .56, y: 3.55, depth: .05, band: 'high' },
  interactions: () => [],
};

export const beanShelf: PieceSpec = {
  kind: 'beanShelf', variants: ['jars', 'halloween'], mount: 'wall', turns: false, footprint: [],
  hang: { width: 2.6, height: .5, y: 2.1, depth: .15, band: 'mid' },
  interactions: () => [{ type: 'poke', reaction: 'bounce' }],
};

export const noticeBoard: PieceSpec = {
  kind: 'noticeBoard', variants: ['cork'], mount: 'wall', turns: false, footprint: [],
  hang: { width: 2.1, height: 1.5, y: 2.55, depth: .08, band: 'mid' },
  interactions: () => [{ type: 'open', panel: 'notice' }],
};

export const lamp: PieceSpec = {
  kind: 'lamp', variants: ['brass', 'festival'], mount: 'wall', turns: false, footprint: [],
  hang: { width: .8, height: 1.2, y: 3.5, depth: .56, band: 'high' },
  interactions: () => [],
};

export const door: PieceSpec = {
  kind: 'door', variants: ['oak'], mount: 'wall', turns: false, footprint: [],
  hang: { width: 1.5, height: 2.7, y: 1.55, depth: .07, band: 'mid' },
  interactions: () => [],
};

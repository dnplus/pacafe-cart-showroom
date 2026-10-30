import type { PieceSpec } from './types';

/** The cart shelf hung behind the counter: three boards of four slots each, taller than the bean shelf it replaces. */
export const beanShelf: PieceSpec = {
  kind: 'beanShelf', variants: ['jars'], mount: 'wall', turns: false, footprint: [],
  hang: { width: 2.6, height: 1.95, y: 2.3, depth: .2, band: 'mid' },
  interactions: () => [{ type: 'poke', reaction: 'bounce' }, { type: 'open', panel: 'counter' }],
};

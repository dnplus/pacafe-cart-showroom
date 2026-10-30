import type { PieceSpec } from './types';

/** The cart shelf hung behind the counter: three boards of four slots each, taller than the bean shelf it replaces. */
export const beanShelf: PieceSpec = {
  kind: 'beanShelf', variants: ['jars'], mount: 'wall', turns: false,
  hang: { width: 3.2, height: 2.4, y: 2.45, depth: .2, band: 'mid' },
  interactions: () => [{ type: 'poke', reaction: 'bounce' }, { type: 'open', panel: 'counter' }],
};

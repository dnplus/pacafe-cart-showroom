import { local, type PieceSpec } from './types';

const runs = { counter: { x: 0, z: 0, halfX: 2.15, halfZ: .4 }, ret: { x: -1.85, z: -.95, halfX: .3, halfZ: .55 }, back: { x: .35, z: -1.45, halfX: 1.6, halfZ: .2 } };
const COUNTER_HEIGHT = 1.05;
const counterTop = COUNTER_HEIGHT + .08, cabinetTop = 1.19;

export const bar: PieceSpec = {
  kind: 'bar', variants: ['walnut', 'oak'], mount: 'floor', turns: true,
  interactions: item => [
    { type: 'serve', spot: local(item, -.75, -.85) },
    { type: 'open', panel: 'counter' },
  ],
  surfaces: item => [
    { ...local(item, 1.6, -.12), y: counterTop }, { ...local(item, -1.85, -1.15), y: counterTop },
    { ...local(item, runs.back.x + .7, runs.back.z + .02), y: cabinetTop + .06 }, { ...local(item, runs.back.x - .15, runs.back.z), y: cabinetTop + .06 },
  ],
};

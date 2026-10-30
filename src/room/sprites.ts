import { sheetFormats, type SheetFormat } from '../../shared/sprites';
import { compass, type Facing, type Vec } from './behavior';

type CardFacing = 'S' | 'W' | 'N' | 'E';
const STEP = Math.PI / 4;
const DIAGONAL_TIE = 1e-9;
const axisOf = (v: Vec): Vec => Math.abs(v.x) - Math.abs(v.z) > DIAGONAL_TIE * (Math.abs(v.x) + Math.abs(v.z)) ? { x: Math.sign(v.x) || 1, z: 0 } : { x: 0, z: Math.sign(v.z) || 1 };

function cardNormal(view: Vec = { x: 0, z: 1 }): Vec { return axisOf(view); }
export function cardYaw(view?: Vec) { const n = cardNormal(view); return Math.atan2(n.x, n.z); }

export function cardFacing(facing: Facing, view: Vec = { x: 0, z: 1 }): CardFacing {
  if (facing === 'S' || facing === 'N' || facing === 'E' || facing === 'W') return facing;
  const len = Math.hypot(view.x, view.z) || 1;
  const south = { x: view.x / len, z: view.z / len }, east = { x: south.z, z: -south.x }, north = { x: -south.x, z: -south.z };
  const angle = compass.indexOf(facing) * STEP; const sx = Math.sin(angle), sy = Math.cos(angle);
  const axis = axisOf({ x: sx * east.x + sy * north.x, z: sx * east.z + sy * north.z });
  const n = cardNormal(view), right = { x: n.z, z: -n.x };
  const out = axis.x * n.x + axis.z * n.z, along = axis.x * right.x + axis.z * right.z;
  return out > .5 ? 'S' : out < -.5 ? 'N' : along > 0 ? 'E' : 'W';
}

export function sheetCell(format: SheetFormat, facing: Facing, frame: number, view: Vec | undefined, moving: boolean) {
  const row = (sheetFormats[format].facings as readonly Facing[]).indexOf(cardFacing(facing, view));
  return { col: moving ? frame % 8 : 0, row };
}

export function standingCells(format: SheetFormat): [number, number][] {
  return (['S', 'W', 'N', 'E'] as const).map(facing => [0, (sheetFormats[format].facings as readonly Facing[]).indexOf(facing)]);
}

export function sheetThumb(format: SheetFormat) {
  const { cols, rows } = sheetFormats[format];
  return { backgroundSize: `${cols * 100}% ${rows * 100}%`, backgroundPosition: '0 0%' };
}

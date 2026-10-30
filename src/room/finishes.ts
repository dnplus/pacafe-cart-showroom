import { roomFinishCatalog, type RoomFinishId } from '../../shared/room-finishes';

type Ctx = CanvasRenderingContext2D;
const SIZE = 512;
/** World units one painted tile covers; `full` stretches it over the whole wall height (a wainscot has one chair rail). */
export const finishTile: Record<RoomFinishId, { x: number; y: number | 'full' }> = {
  'wall-oat-limewash': { x: 2.4, y: 2.4 }, 'wall-sage-stripe': { x: .64, y: .64 }, 'wall-red-brick': { x: 1.4, y: 1.4 },
  'wall-walnut-wainscot': { x: .8, y: 'full' }, 'wall-sky-tile': { x: .6, y: .6 }, 'wall-starry-night': { x: 1.8, y: 1.8 },
  'floor-walnut-plank': { x: 1.6, y: 1.6 }, 'floor-oak-herringbone': { x: 1, y: 1 }, 'floor-cafe-checker': { x: .9, y: .9 },
  'floor-terracotta-tile': { x: .9, y: .9 }, 'floor-speckled-terrazzo': { x: 1.2, y: 1.2 }, 'floor-gilded-marble': { x: 2.4, y: 2.4 },
};

function random(seed: string) {
  let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ h >>> 15, 1 | h); h ^= h + Math.imul(h ^ h >>> 7, 61 | h); return ((h ^ h >>> 14) >>> 0) / 4294967296; };
}
/** Moves a hex colour toward white (positive) or black (negative) by `amount` of the way. */
function shade(hex: string, amount: number) {
  const channels = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)), target = amount > 0 ? 255 : 0;
  return `#${channels.map(value => Math.round(value + (target - value) * Math.min(1, Math.abs(amount) * 2)).toString(16).padStart(2, '0')).join('')}`;
}
/** Draws once per neighbouring tile so shapes crossing an edge come back on the other side. */
const wrapped = (draw: (dx: number, dy: number) => void) => { for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) draw(dx, dy); };

function grid(ctx: Ctx, rows: number, cols: number, stagger: boolean, base: string, grout: string, rnd: () => number, line: number) {
  ctx.fillStyle = grout; ctx.fillRect(0, 0, SIZE, SIZE);
  const w = SIZE / cols, h = SIZE / rows;
  for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
    const x = c * w + (stagger && r % 2 ? w / 2 : 0);
    ctx.fillStyle = shade(base, (rnd() - .5) * .06);
    ctx.fillRect(x + line / 2, r * h + line / 2, w - line, h - line);
  }
}

const painters: Record<string, (ctx: Ctx, base: string, accent: string, rnd: () => number) => void> = {
  limewash(ctx, base, accent, rnd) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * SIZE, y = rnd() * SIZE, r = 50 + rnd() * 110, alpha = .14 + rnd() * .18;
      wrapped((dx, dy) => { const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); g.addColorStop(0, accent); g.addColorStop(1, `${accent}00`); ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2); });
    }
    ctx.globalAlpha = 1;
  },
  stripe(ctx, base, accent) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = accent; ctx.fillRect(SIZE * .1, 0, SIZE * .3, SIZE);
    ctx.fillStyle = shade(accent, -.08); ctx.fillRect(SIZE * .62, 0, SIZE * .04, SIZE);
  },
  brick(ctx, base, accent, rnd) { grid(ctx, 8, 4, true, base, accent, rnd, 10); },
  wainscot(ctx, base, accent) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, SIZE, SIZE);
    const rail = SIZE * .62;
    ctx.fillStyle = accent; ctx.fillRect(0, rail, SIZE, SIZE - rail);
    ctx.fillStyle = shade(accent, .06); ctx.fillRect(SIZE * .12, rail + SIZE * .07, SIZE * .76, SIZE * .25);
    ctx.strokeStyle = shade(accent, -.12); ctx.lineWidth = 6; ctx.strokeRect(SIZE * .12, rail + SIZE * .07, SIZE * .76, SIZE * .25);
    ctx.fillStyle = shade(accent, -.1); ctx.fillRect(0, rail - 10, SIZE, 18);
  },
  tile(ctx, base, accent, rnd) { const wall = ctx.canvas.dataset.surface === 'wall'; grid(ctx, wall ? 4 : 2, 2, wall, base, accent, rnd, wall ? 8 : 12); },
  stars(ctx, base, accent, rnd) {
    const g = ctx.createLinearGradient(0, 0, 0, SIZE); g.addColorStop(0, base); g.addColorStop(.5, shade(base, .04)); g.addColorStop(1, base);
    ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * SIZE, y = rnd() * SIZE, r = 1 + rnd() * 2.4; ctx.globalAlpha = .5 + rnd() * .5;
      wrapped((dx, dy) => { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill(); });
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 7; i++) {
      const x = rnd() * SIZE, y = rnd() * SIZE, r = 9 + rnd() * 9;
      wrapped((dx, dy) => { ctx.fillStyle = accent; ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, l = k % 2 ? r * .28 : r; ctx.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); } ctx.closePath(); ctx.fill(); });
    }
  },
  plank(ctx, base, accent, rnd) {
    ctx.fillStyle = accent; ctx.fillRect(0, 0, SIZE, SIZE);
    const w = SIZE / 4;
    for (let c = 0; c < 4; c++) {
      const joint = rnd() * SIZE;
      for (const [y, h] of [[joint - SIZE, SIZE], [joint, SIZE]] as const) {
        ctx.fillStyle = shade(base, (rnd() - .5) * .08); ctx.fillRect(c * w + 3, y + 3, w - 6, h - 6);
        ctx.strokeStyle = shade(base, -.05); ctx.lineWidth = 2; ctx.globalAlpha = .35;
        for (let k = 0; k < 4; k++) { const x = c * w + 12 + rnd() * (w - 24); ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.bezierCurveTo(x + 6, y + h * .3, x - 6, y + h * .7, x, y + h - 6); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    }
  },
  herringbone(ctx, base, accent, rnd) {
    ctx.fillStyle = accent; ctx.fillRect(0, 0, SIZE, SIZE);
    // A 2:1 herringbone repeats every 4 slat widths along both axes (lattice (1,1), (3,-1)).
    const u = SIZE / 4;
    for (let a = -6; a <= 6; a++) for (let b = -3; b <= 3; b++) {
      const x = (a + 3 * b) * u, y = (a - b) * u;
      if (x < -3 * u || x > SIZE + u || y < -3 * u || y > SIZE + u) continue;
      ctx.fillStyle = shade(base, (rnd() - .5) * .08); ctx.fillRect(x + 2, y + 2, 2 * u - 4, u - 4);
      ctx.fillStyle = shade(base, (rnd() - .5) * .08 - .03); ctx.fillRect(x + 2, y + u + 2, u - 4, 2 * u - 4);
    }
  },
  checker(ctx, base, accent) {
    const h = SIZE / 2; ctx.fillStyle = base; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = accent; ctx.fillRect(h, 0, h, h); ctx.fillRect(0, h, h, h);
    ctx.strokeStyle = shade(base, -.12); ctx.lineWidth = 3; ctx.strokeRect(0, 0, SIZE, SIZE); ctx.beginPath(); ctx.moveTo(h, 0); ctx.lineTo(h, SIZE); ctx.moveTo(0, h); ctx.lineTo(SIZE, h); ctx.stroke();
  },
  terrazzo(ctx, base, accent, rnd) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, SIZE, SIZE);
    const chips = [accent, '#c98b6b', '#f8f6f2', '#6d7470', '#d9b88a'];
    for (let i = 0; i < 260; i++) {
      const x = rnd() * SIZE, y = rnd() * SIZE, r = 2 + rnd() ** 2 * 11, sides = 4 + Math.floor(rnd() * 3), turn = rnd() * Math.PI, color = chips[Math.floor(rnd() * chips.length)];
      wrapped((dx, dy) => { ctx.fillStyle = color; ctx.beginPath(); for (let k = 0; k < sides; k++) { const a = turn + k * Math.PI * 2 / sides; ctx.lineTo(x + dx + Math.cos(a) * r * (.7 + (k % 2) * .3), y + dy + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); });
    }
  },
  marble(ctx, base, accent, rnd) {
    ctx.fillStyle = base; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 14; i++) {
      const gold = i < 4, x = rnd() * SIZE, y = rnd() * SIZE, length = 160 + rnd() * 260, angle = -.6 + rnd() * .5;
      const points = Array.from({ length: 6 }, (_, k) => [x + Math.cos(angle) * length * k / 5 + (rnd() - .5) * 40, y + Math.sin(angle) * length * k / 5 + (rnd() - .5) * 40]);
      ctx.strokeStyle = gold ? accent : '#a69f95'; ctx.globalAlpha = gold ? .9 : .35 + rnd() * .3; ctx.lineWidth = gold ? 4 + rnd() * 3 : 3 + rnd() * 5;
      wrapped((dx, dy) => { ctx.beginPath(); points.forEach(([px, py], k) => k ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)); ctx.stroke(); });
    }
    ctx.globalAlpha = 1;
  },
};

export function paintFinish(id: RoomFinishId, size = SIZE): HTMLCanvasElement | null {
  const finish = roomFinishCatalog[id], canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE; canvas.dataset.surface = finish.surface;
  let ctx: Ctx | null;
  try { ctx = canvas.getContext('2d'); } catch { return null; }
  if (!ctx) return null;
  painters[finish.pattern](ctx, finish.base, finish.accent, random(id));
  if (size === SIZE) return canvas;
  const small = document.createElement('canvas'); small.width = small.height = size;
  small.getContext('2d')?.drawImage(canvas, 0, 0, size, size);
  return small;
}

const swatches = new Map<RoomFinishId, string | null>();
/** A data URL of one painted tile for the shop and decorate panel, or null where the browser cannot paint. */
export function finishSwatch(id: RoomFinishId): string | null {
  if (!swatches.has(id)) swatches.set(id, paintFinish(id, 192)?.toDataURL() ?? null);
  return swatches.get(id)!;
}

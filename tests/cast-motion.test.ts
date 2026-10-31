import { describe, expect, it } from 'vitest';
import { characters } from '../shared/domain';
import { DEFAULT_CHARACTER } from '../shared/cast';
import { sheetFormats } from '../shared/sprites';
import { actorCell, beatPose, cartCue, FRAME_MS, newActor, sendTo, stepActor, type Actor, type Area } from '../src/room/castMotion';
import { baristaBodies, ownerBodies } from '../src/room/barista';
import { residentArt } from '../src/room/residentArt';

const area: Area = { minX: 0, maxX: 3, minZ: -1, maxZ: 1 };
const run = (actor: Actor, seconds: number, options: Partial<Parameters<typeof stepActor>[1]> = {}) => {
  let now = 1000, current = actor;
  for (let i = 0; i < seconds * 20; i++) { now += 50; current = stepActor(current, { now, dt: .05, area, rand: () => .5, still: false, stroll: 3000, ...options }); }
  return current;
};

describe('the cast registry', () => {
  it('has Muse first and as the default clerk', () => {
    expect(characters[0]).toBe('muse');
    expect(DEFAULT_CHARACTER).toBe('muse');
  });
  it('gives Muse a walk sheet that is tried before the single standee, and the owner too', () => {
    expect(residentArt.muse.sheet).toMatch(/muse-spritesheet\.png$/);
    const [first, second] = baristaBodies('muse');
    expect(first.sheet).toBe(true); expect(second.sheet).toBeUndefined();
    const owner = ownerBodies(null);
    expect(owner[0]).toMatchObject({ sheet: true }); expect(owner.at(-1)?.src).toMatch(/^data:/);
    expect(ownerBodies('blob:photo')[0].src).toBe('blob:photo');
  });
  it('lays the sheet out like Muse: four facings of eight frames', () => {
    expect(sheetFormats.four).toMatchObject({ width: 2048, height: 1024, cols: 8, rows: 4 });
  });
});

describe('walking', () => {
  it('stays put when the room is still (reduced motion or paused) and drops its route', () => {
    const away = sendTo(newActor({ x: 1, z: 0 }), [{ x: 3, z: 0 }]);
    const after = run(away, 5, { still: true });
    expect(after.at).toEqual({ x: 1, z: 0 }); expect(after.moving).toBe(false); expect(after.route).toEqual([]);
  });
  it('walks to a stop, waits there, and carries on to the next', () => {
    const errand = sendTo(newActor({ x: 1, z: 0 }), [{ x: 2, z: 0, wait: 1000 }, { x: 1, z: 0 }]);
    const midway = run(errand, 1, { stroll: 0 });
    expect(midway.moving).toBe(true); expect(midway.at.x).toBeGreaterThan(1.5);
    const there = run(errand, 1.6, { stroll: 0 });
    expect(there.at).toEqual({ x: 2, z: 0 }); expect(there.moving).toBe(false);
    const home = run(errand, 4, { stroll: 0 });
    expect(home.at).toEqual({ x: 1, z: 0 }); expect(home.route).toEqual([]);
  });
  it('strolls on its own, always inside its area', () => {
    let now = 0, actor = newActor({ x: 1, z: 0 }), moved = false, seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2400; i++) {
      now += 50; actor = stepActor(actor, { now, dt: .05, area, rand, still: false, stroll: 2000 });
      moved ||= actor.moving;
      expect(actor.at.x).toBeGreaterThanOrEqual(area.minX - 1e-9); expect(actor.at.x).toBeLessThanOrEqual(area.maxX + 1e-9);
      expect(actor.at.z).toBeGreaterThanOrEqual(area.minZ - 1e-9); expect(actor.at.z).toBeLessThanOrEqual(area.maxZ + 1e-9);
    }
    expect(moved).toBe(true);
  });
  it('shows the standing cell when idle and cycles the walk frames (columns 1 to 7) when moving', () => {
    const view = { x: 0, z: 1 };
    expect(actorCell(newActor({ x: 0, z: 0 }), view, 0)).toEqual({ col: 0, row: 0 });
    const walking: Actor = { ...newActor({ x: 0, z: 0 }), moving: true, heading: { x: 1, z: 0 } };
    const cols = new Set(Array.from({ length: 7 }, (_, i) => actorCell(walking, view, i * FRAME_MS).col));
    expect(cols.size).toBe(7); expect(cols.has(0)).toBe(false);
    expect(actorCell(walking, view, FRAME_MS).row).toBe(sheetFormats.four.facings.indexOf('E'));
    expect(actorCell({ ...walking, heading: { x: -1, z: 0 } }, view, 0).row).toBe(sheetFormats.four.facings.indexOf('W'));
    expect(actorCell({ ...walking, heading: { x: 0, z: -1 } }, view, 0).row).toBe(sheetFormats.four.facings.indexOf('N'));
    expect(actorCell({ ...walking, heading: { x: 0, z: 1 } }, view, 0).row).toBe(sheetFormats.four.facings.indexOf('S'));
  });
});

describe('reacting', () => {
  it('hops and shows a mark, then ends', () => {
    const beat = { cue: 'unboxed' as const, since: 0 };
    expect(beatPose(beat, 90, false).hop).toBeGreaterThan(.2);
    expect(beatPose(beat, 90, false).mark).toBe('♪');
    expect(beatPose(beat, 5000, false)).toMatchObject({ hop: 0, mark: null, over: true });
    expect(beatPose(undefined, 0, false).over).toBe(true);
  });
  it('keeps the mark but never hops in a calm room', () => {
    const pose = beatPose({ cue: 'arrival', since: 0 }, 90, true);
    expect(pose.hop).toBe(0); expect(pose.stretch).toBe(0); expect(pose.mark).toBe('!');
  });
  it('reads the cart: the first look is not news, a new item arrives, an unboxed item cheers', () => {
    expect(cartCue(null, { items: 5, shelved: 5 })).toBeNull();
    expect(cartCue({ items: 5, shelved: 5 }, { items: 5, shelved: 5 })).toBeNull();
    expect(cartCue({ items: 5, shelved: 5 }, { items: 6, shelved: 5 })).toBe('arrival');
    expect(cartCue({ items: 6, shelved: 5 }, { items: 6, shelved: 6 })).toBe('unboxed');
    expect(cartCue({ items: 6, shelved: 5 }, { items: 5, shelved: 5 })).toBeNull();
  });
});

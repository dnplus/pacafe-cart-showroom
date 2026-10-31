/** A parcel's progress from the courier to the shelf; a box is in exactly one phase, and only a slice carries a progress. */
export type Box =
  | { id: string; phase: 'arriving' }
  | { id: string; phase: 'atCounter' }
  | { id: string; phase: 'slicing'; progress: number }
  | { id: string; phase: 'opened' }
  | { id: string; phase: 'shelved' };
export type BoxPhase = Box['phase'];

/** A slit this much of the tape long opens the box. Under 1 so a thumb that lifts a hair early still counts. */
export const SLICE_DONE = 0.85;

export type UnboxEvent =
  /** The cart's items in order and the ids the server says are unboxed: new items arrive, unboxed ones sit on the shelf, gone ones leave. */
  | { type: 'sync'; ids: readonly string[]; opened: ReadonlySet<string> }
  | { type: 'arrived'; id: string }
  | { type: 'slice'; id: string; progress: number }
  /** The finger lifted or left the tape. */
  | { type: 'release'; id: string }
  /** The server has recorded these as unboxed and their pop-out is over. */
  | { type: 'shelved'; ids: readonly string[] }
  | { type: 'openAll' };

const when = (boxes: readonly Box[], id: string, change: (box: Box) => Box) => boxes.map(box => box.id === id ? change(box) : box);

/**
 * A lifted finger drops a half-cut slit back to atCounter with nothing kept: the slit is one stroke along the tape, so a retry starts
 * the stroke again, and a box never rests half open.
 */
export function unboxReducer(boxes: readonly Box[], event: UnboxEvent): readonly Box[] {
  switch (event.type) {
    case 'sync': {
      const known = new Map(boxes.map(box => [box.id, box]));
      return event.ids.map((id): Box => {
        const box = known.get(id);
        // A box popping out stays until its write lands, whatever the server already says.
        if (event.opened.has(id)) return box?.phase === 'opened' ? box : { id, phase: 'shelved' };
        return box ?? { id, phase: 'arriving' };
      });
    }
    case 'arrived': return when(boxes, event.id, box => box.phase === 'arriving' ? { id: box.id, phase: 'atCounter' } : box);
    case 'slice': return when(boxes, event.id, box => {
      if (box.phase !== 'atCounter' && box.phase !== 'slicing') return box;
      if (event.progress >= SLICE_DONE) return { id: box.id, phase: 'opened' };
      return event.progress > 0 ? { id: box.id, phase: 'slicing', progress: event.progress } : box;
    });
    case 'release': return when(boxes, event.id, box => box.phase === 'slicing' ? { id: box.id, phase: 'atCounter' } : box);
    case 'shelved': return boxes.map(box => box.phase === 'opened' && event.ids.includes(box.id) ? { id: box.id, phase: 'shelved' } : box);
    case 'openAll': return boxes.map(box => box.phase === 'shelved' ? box : { id: box.id, phase: 'opened' });
  }
}

/** The ids the room's shelf may draw: parcels already unboxed and recorded. */
export const shelvedIds = (boxes: readonly Box[]): ReadonlySet<string> => new Set(boxes.filter(box => box.phase === 'shelved').map(box => box.id));

/** The part of the tape a stroke has cut, as fractions of its length. */
export interface Slit { readonly lo: number; readonly hi: number }
/** The pointer relative to the tape: `along` is 0 at its left end and 1 at its right (past either end is allowed); `off` is px from its centerline. */
export interface TapePoint { readonly along: number; readonly off: number }

/**
 * The slit after the pointer moves to `point`. The stroke is one connected path, so the cut is the span it has swept, and going back and forth
 * adds nothing. Straying more than `reach` px from the tape ends the stroke (null), so a swipe across the lid below it cuts nothing.
 */
export function extendSlit(slit: Slit | null, point: TapePoint, reach: number): Slit | null {
  if (Math.abs(point.off) > reach) return null;
  const at = Math.min(1, Math.max(0, point.along));
  return slit ? { lo: Math.min(slit.lo, at), hi: Math.max(slit.hi, at) } : { lo: at, hi: at };
}

/** How much of the tape is cut, 0 to 1. */
export const sliceProgress = (slit: Slit | null) => slit ? slit.hi - slit.lo : 0;

/** A single parcel's reveal: flaps open, the product rises and hangs where it can be read, then settles toward the shelf. */
export const REVEAL_MS = 3400;
/** Several parcels opened together fly out fast and compact, staggered by STAGGER_MS, so a burst reads as a burst. */
export const QUICK_MS = 700;
export const STAGGER_MS = 90;
export const STAGGERED = 6;
/** Under reduced motion the card does not travel: it fades in, stays long enough to read, and a burst does not wait at all. */
export const REDUCED_REVEAL_MS = 1100;
export const REDUCED_QUICK_MS = 120;

/** How long `count` parcels opened at once take to play out; the write to the server waits for it. */
export function popDuration(count: number, reduced: boolean) {
  if (count <= 1) return reduced ? REDUCED_REVEAL_MS : REVEAL_MS;
  return reduced ? REDUCED_QUICK_MS : QUICK_MS + Math.min(count - 1, STAGGERED) * STAGGER_MS;
}

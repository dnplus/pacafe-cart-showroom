import { Composition } from 'remotion';
import { PROMO_COMPOSITION, PROMO_FORMAT, storyboardSchema, type PromoInput } from '../storyboard.ts';
import { Promo } from './Promo.tsx';

/** Only here so the composition opens on its own; the runner always passes a job's props. */
const preview: PromoInput = { voice: [], storyboard: { durationSec: 6, priceMode: 'hidden', scenes: [
  { kind: 'opening', id: 'opening', startSec: 0, endSec: 3, subtitle: ['這是屋主的小屋購物車。'], nickname: '屋主', count: 0, total: null },
  { kind: 'ending', id: 'ending', startSec: 3, endSec: 6, subtitle: ['都擺在小屋的貨架上。'], more: 0 },
] } };

export function Root() {
  return (
    <Composition id={PROMO_COMPOSITION} component={Promo} {...PROMO_FORMAT} durationInFrames={1} defaultProps={preview}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.round(storyboardSchema.parse(props.storyboard).durationSec * PROMO_FORMAT.fps) })} />
  );
}

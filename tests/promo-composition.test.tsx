import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { PromoFrame } from '../runner/composition/Promo';
import { fallbackStoryboard } from '../runner/storyboard';
import { claimFor } from './fake-runner-worker';

/** The text a frame shows, tags dropped and entities decoded. */
const shownText = (markup: string) => markup.replace(/<[^>]+>/g, '\n').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');

describe('promo composition', () => {
  const storyboard = fallbackStoryboard(claimFor(fixtureCartItems, 'exact').view, { durationSec: 30 });
  const frameAt = (atSec: number) => shownText(renderToStaticMarkup(<PromoFrame storyboard={storyboard} atSec={atSec} />));

  it('shows both disclaimer sentences word for word in the ending', () => {
    const end = storyboard.scenes.at(-1)!;
    const text = frameAt((end.startSec + end.endSec) / 2);
    expect(text).toContain('Not affiliated with, endorsed by, or sponsored by Meta.');
    expect(text).toContain("uses Meta's Muse models via the Meta Model API");
  });

  it('shows an item card with its title, quantity, price and subtitle', () => {
    const scene = storyboard.scenes[1];
    const text = frameAt((scene.startSec + scene.endSec) / 2);
    expect(text).toContain('手沖咖啡濾杯 陶瓷 02');
    expect(text).toContain('NT$ 650');
    expect(text).toContain(scene.subtitle[0]);
    expect(text).not.toContain('sponsored by Meta');
  });
});

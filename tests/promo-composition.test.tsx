import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { Picture, PromoFrame } from '../runner/composition/Promo';
import { fallbackStoryboard } from '../runner/storyboard';
import { claimFor } from './fake-runner-worker';

/** The text a frame shows, tags dropped and entities decoded. */
const shownText = (markup: string) => markup.replace(/<[^>]+>/g, '\n').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');

describe('promo composition', () => {
  const storyboard = fallbackStoryboard(claimFor(fixtureCartItems, 'exact').view, { durationSec: 30 });
  const frameAt = (atSec: number) => shownText(renderToStaticMarkup(<Picture value={({ src, style }) => <img src={src} style={style} />}><PromoFrame storyboard={storyboard} atSec={atSec} /></Picture>));

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

  it('puts the owner on the set in every scene, with the product picture on its card', () => {
    const items = fixtureCartItems.map((item, i) => i === 0 ? { ...item, imageUrl: 'https://img.example.com/dripper.jpg' } : item);
    const pictured = fallbackStoryboard(claimFor(items, 'exact').view, { durationSec: 30 });
    const markupAt = (atSec: number) => renderToStaticMarkup(<Picture value={({ src }) => <img src={src} />}><PromoFrame storyboard={pictured} atSec={atSec} /></Picture>);
    for (const scene of pictured.scenes) expect(markupAt(scene.endSec - .1)).toMatch(/owner-fullbody/);
    expect(markupAt(pictured.scenes[1].startSec + 1)).toContain('https://img.example.com/dripper.jpg');
    expect(pictured.scenes[0].subtitle.join('')).toContain('歡迎來到');
  });

  it('speaks and labels in English when the job asks for it, item titles left as the owner saved them', () => {
    const english = fallbackStoryboard(claimFor(fixtureCartItems, 'range', 30, 'en').view, { durationSec: 30, language: 'en' });
    const at = (i: number) => shownText(renderToStaticMarkup(<Picture value={({ src }) => <img src={src} />}><PromoFrame storyboard={english} atSec={english.scenes[i].startSec + 1} /></Picture>));
    expect(english.language).toBe('en');
    expect(at(0)).toContain("小島's Cart Showroom");
    expect(english.scenes[0].subtitle[0]).toBe("Welcome to 小島's Cart Showroom!");
    expect(at(1)).toContain('No. 1');
    expect(english.scenes[1].subtitle[0]).toMatch(/^手沖咖啡濾杯 陶瓷 02, about NT\$ /);
    expect(english.scenes.at(-1)!.subtitle).toEqual(["That's all for today.", 'Come browse the whole shelf!']);
  });
});

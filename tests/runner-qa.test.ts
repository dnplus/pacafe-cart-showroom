import { describe, expect, it } from 'vitest';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { fitVoice, FIXES, mockReview, VOICE_TAIL_SEC } from '../runner/qa';
import { fallbackStoryboard, storyboardSchema, SUBTITLE, textWidthEm, type Storyboard } from '../runner/storyboard';
import { claimFor } from './fake-runner-worker';

const board = (scenes: Storyboard['scenes']): Storyboard => storyboardSchema.parse({ durationSec: scenes.at(-1)!.endSec, priceMode: 'hidden', scenes });
const opening = (endSec: number, subtitle: string[]) => ({ kind: 'opening' as const, id: 'opening', startSec: 0, endSec, subtitle, nickname: '小島', count: 1, total: null });
const item = (startSec: number, endSec: number, subtitle: string[], id = 'item-1') => ({ kind: 'item' as const, id, startSec, endSec, subtitle, title: '帆布托特包', qty: 1, price: null, image: null });
const seconds = (scene: Storyboard['scenes'][number]) => scene.endSec - scene.startSec;
const ending = (startSec: number, endSec: number) => ({ kind: 'ending' as const, id: 'ending', startSec, endSec, subtitle: ['都擺在小屋的貨架上。'], more: 0 });

describe('fitVoice', () => {
  it('grows a scene whose voice runs past its end, borrowing from scenes with time to spare', () => {
    const before = board([opening(4, ['這是小島的小屋購物車。']), item(4, 9, ['帆布托特包。']), ending(9, 14)]);
    const voice = [{ sceneId: 'opening', durationSec: 5.03 }, { sceneId: 'item-1', durationSec: 1.4 }, { sceneId: 'ending', durationSec: 4.3 }].map(clip => ({ ...clip, src: '' }));
    const after = fitVoice(before, voice);
    after.scenes.forEach((scene, i) => expect(seconds(scene)).toBeGreaterThanOrEqual(voice[i].durationSec + VOICE_TAIL_SEC - 1 / 30));
    expect(seconds(after.scenes[2])).toBe(5);
    expect(after.durationSec).toBe(14);
    expect(mockReview(after)).toEqual([]);
  });

  it('leaves the storyboard alone when every clip fits', () => {
    const before = board([opening(4, ['這是小島的小屋購物車。']), ending(4, 9)]);
    expect(fitVoice(before, [{ sceneId: 'opening', src: '', durationSec: 2 }])).toBe(before);
  });
});

describe('Fix registry', () => {
  it('forbidden_wording replaces checkout words so the scene passes', () => {
    const before = board([opening(4, ['現在就去結帳，立即購買！']), ending(4, 9)]);
    expect(mockReview(before).map(issue => issue.kind)).toEqual(['forbidden_wording']);
    const after = FIXES.forbidden_wording(before, mockReview(before));
    expect(after.scenes[0].subtitle.join('')).not.toMatch(/結帳|購買/);
    expect(mockReview(after)).toEqual([]);
  });

  it('subtitle_overflow wraps every line inside the safe width without losing words', () => {
    const text = '這是小島的小屋購物車，架上 5 件，都是 Muse 採買時記下的東西，還有更多。';
    const before = board([opening(6, [text]), ending(6, 11)]);
    expect(mockReview(before).map(issue => issue.kind)).toEqual(['subtitle_overflow']);
    const after = FIXES.subtitle_overflow(before, mockReview(before));
    expect(after.scenes[0].subtitle.every(line => textWidthEm(line) <= SUBTITLE.maxWidthEm)).toBe(true);
    expect(after.scenes[0].subtitle.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
    expect(mockReview(after)).toEqual([]);
  });

  it('pacing_too_fast lengthens the scene, takes the time from the others, and keeps the total and the ending', () => {
    const before = board([opening(6, ['這是小島的小屋購物車。']), item(6, 7.5, ['「帆布托特包 燕麥色」，', '大容量，可以放進筆電。']), ending(7.5, 12.5)]);
    expect(mockReview(before).map(issue => `${issue.kind}@${issue.sceneId}`)).toEqual(['pacing_too_fast@item-1']);
    const after = FIXES.pacing_too_fast(before, mockReview(before));
    expect(storyboardSchema.parse(after).durationSec).toBe(12.5);
    expect(seconds(after.scenes[2])).toBeCloseTo(5);
    expect(mockReview(after)).toEqual([]);
  });

  it('pacing_too_fast borrows time from scenes that read slower than the limit, and never makes them fail', () => {
    const long = ['「【現貨】日本製琺瑯細口手沖壺一點二公升附溫度計', '霧面白」，大約 NT$ 1,000–3,000。'];
    const before = board([opening(4, ['這是小島的小屋購物車。', '架上 6 件，都是 Muse 採買時記下的東西。']), item(4, 7.5, ['「無線降噪耳機」，大約 NT$ 3,000–5,000。'], 'item-1'), item(7.5, 11, long, 'item-2'), item(11, 14.5, ['「帆布托特包 燕麥色」，大約 NT$ 500–1,000。'], 'item-3'), ending(14.5, 19.5)]);
    expect(mockReview(before).map(issue => `${issue.kind}@${issue.sceneId}`)).toEqual(['pacing_too_fast@item-2']);
    const after = FIXES.pacing_too_fast(before, mockReview(before));
    expect(seconds(after.scenes[2])).toBeGreaterThan(seconds(before.scenes[2]) + 1);
    expect(seconds(after.scenes[4])).toBeCloseTo(5);
    expect(mockReview(after).filter(issue => issue.sceneId !== 'item-2')).toEqual([]);
  });
});

describe('fallback storyboard', () => {
  it('tiles the video from opening to ending at the job length', () => {
    for (const durationSec of [15, 30, 45]) {
      const storyboard = fallbackStoryboard(claimFor(fixtureCartItems, 'range').view, { durationSec });
      expect(storyboard.scenes.at(-1)!.endSec).toBe(durationSec);
      expect(storyboard.scenes[0].kind).toBe('opening');
      expect(storyboard.scenes.at(-1)!.kind).toBe('ending');
    }
  });
});

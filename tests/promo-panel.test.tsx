import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { promoScriptSchema } from '../shared/script';
import { translate } from '../src/i18n';
import { PromoPanel } from '../src/promo/PromoPanel';
import { usePromo } from '../src/promo/usePromo';
import { claimFor } from './fake-runner-worker';

vi.mock('../src/promo/usePromo', () => ({ usePromo: vi.fn() }));

const panel = (script?: unknown) => {
  vi.mocked(usePromo).mockReturnValue({ job: claimFor(fixtureCartItems, 'range', 30, script ? promoScriptSchema.parse(script) : undefined).job, offline: false, queueing: false, queueFailed: false, queue: async () => {} });
  return renderToStaticMarkup(<PromoPanel count={5} />);
};

describe('PromoPanel script', () => {
  it('says the runner wrote the lines when Muse sent no script', () => {
    expect(panel()).toMatch(/data-author="runner"[^>]*>Script by the runner</);
    expect(panel()).not.toContain('promo-script');
  });

  it('says Muse wrote them and lists the lines, one scene at a time', () => {
    const markup = panel({ opening: ['嗨，歡迎來到我的小屋。'], items: [{ position: 2, title: '降噪耳機', lines: ['通勤全靠它。'] }], ending: ['謝謝你來逛。'] });
    expect(markup).toMatch(/data-author="muse"/);
    expect(markup).toContain('Script by Muse');
    for (const text of ['Opening', 'Item 2 · 降噪耳機', 'Ending', '嗨，歡迎來到我的小屋。', '通勤全靠它。', '謝謝你來逛。']) expect(markup).toContain(text);
  });

  it('has Traditional Chinese for every new string', () => {
    expect(['Script by Muse', 'Script by the runner', 'Show the script', 'Opening', 'Ending'].map(key => translate('zh-TW', key as never))).toEqual(['腳本由 Muse 寫', '腳本由 runner 寫', '看腳本', '開場', '結尾']);
    expect(translate('zh-TW', 'Item {n}', { n: 3 })).toBe('第 3 件');
  });
});

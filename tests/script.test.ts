import { describe, expect, it } from 'vitest';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { promoScriptSchema, scriptProblems, scriptScenes, type PromoScript } from '../shared/script';
import { emptyCart, replaceCart } from '../shared/cart';
import { shareView, type PriceMode } from '../shared/share';

const view = (mode: PriceMode) => shareView(replaceCart(emptyCart(), fixtureCartItems, new Date().toISOString()), { slug: 'a'.repeat(22), enabled: false, prices: mode, nickname: '小島' });
const messages = (input: unknown) => { const parsed = promoScriptSchema.safeParse(input); return parsed.success ? [] : parsed.error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`); };

describe('promoScriptSchema', () => {
  it('takes a script with any of the three parts and keeps the order of its items', () => {
    const script = { opening: ['嗨，歡迎來到我的小屋。'], items: [{ position: 2, lines: ['這副耳機通勤很安靜。'] }, { position: 1, title: '手沖咖啡濾杯', lines: ['週末的咖啡靠它。'] }], ending: ['謝謝你來逛。'] };
    expect(promoScriptSchema.parse(script)).toEqual(script);
    expect(promoScriptSchema.parse({ ending: ['謝謝你來逛。'] })).toEqual({ ending: ['謝謝你來逛。'] });
  });

  it('refuses what Muse can fix, saying which line and how', () => {
    expect(messages({})).toEqual([' 腳本至少要有 opening、items 或 ending 其中一景。']);
    expect(messages({ opening: ['這是一行很長很長很長很長很長很長很長很長很長很長很長很長的口白。'] })[0]).toMatch(/opening\.0 .*一行最多 30 字/);
    expect(messages({ opening: ['一', '二', '三', '四'] })).toEqual(['opening 這一景最多 3 行，多的併進同一句或留給下一景']);
    expect(messages({ items: [{ position: 1, lines: ['a', 'b', 'c'] }] })[0]).toMatch(/items\.0\.lines 這一景最多 2 行/);
    expect(messages({ items: [{ position: 1, lines: ['好用'] }, { position: 1, lines: ['也好用'] }] })).toEqual(['items.1.position position 1 寫了兩次，每件東西只有一景。']);
    expect(messages({ items: [{ position: 0, lines: ['好用'] }] })).not.toEqual([]);
    expect(messages({ opening: ['  '] })[0]).toMatch(/不能是空行/);
    expect(messages({ opening: [], ending: ['謝謝'] })[0]).toMatch(/至少一行/);
    expect(messages({ opening: ['嗨'], extra: 1 })).not.toEqual([]);
  });

  it('refuses checkout wording, in Chinese and English, naming the word and a softer one', () => {
    for (const word of ['立即購買', '結帳', '付款', '下單', '購買', 'Buy now', 'check out']) {
      const [message] = messages({ ending: [`想要就${word}吧`] });
      expect(message).toMatch(/ending\.0 .*沒有結帳流程.*記下/);
    }
    expect(messages({ ending: ['想看全部，來小屋的貨架逛逛。'] })).toEqual([]);
  });
});

describe('scriptProblems', () => {
  const script = (over: Partial<PromoScript>): PromoScript => promoScriptSchema.parse({ opening: ['嗨'], ...over });

  it('accepts a position with no title, a matching title, or a shortened one', () => {
    expect(scriptProblems(script({ items: [{ position: 1, lines: ['好'] }, { position: 2, title: '降噪耳機', lines: ['好'] }, { position: 4, title: '鑄鐵平底鍋 24cm', lines: ['好'] }] }), view('range'), 30)).toEqual([]);
  });

  it('refuses a title that is not the item at that position, naming the one that is', () => {
    expect(scriptProblems(script({ items: [{ position: 2, title: '帆布托特包', lines: ['好'] }] }), view('range'), 30))
      .toEqual(['items 的 position 2 寫的 title「帆布托特包」，但貨架第 2 件是「無線降噪耳機」。position 照 cart_list 的順序從 1 算起；要嘛改 position，要嘛拿掉 title。']);
  });

  it('refuses a position with no scene at this length', () => {
    expect(scriptProblems(script({ items: [{ position: 5, lines: ['好'] }] }), view('range'), 15)[0]).toMatch(/position 5 沒有場景：15 秒、5 件東西，只有前 3 件各有一景/);
    expect(scriptProblems(script({ items: [{ position: 5, lines: ['好'] }] }), view('range'), 30)).toEqual([]);
  });

  it('refuses an amount only when the owner hides prices', () => {
    const priced = script({ opening: ['這個才 NT$650。'], items: [{ position: 1, lines: ['只要 650 元'] }], ending: ['謝謝'] });
    expect(scriptProblems(priced, view('hidden'), 30)).toHaveLength(2);
    expect(scriptProblems(priced, view('hidden'), 30)[0]).toMatch(/^opening 提到價錢/);
    expect(scriptProblems(priced, view('hidden'), 30)[1]).toMatch(/^items position 1 提到價錢/);
    expect(scriptProblems(priced, view('range'), 30)).toEqual([]);
  });

  it('names scenes the way the storyboard does', () => {
    expect([...scriptScenes(script({ items: [{ position: 3, lines: ['好'] }], ending: ['再見'] }))]).toEqual([['opening', ['嗨']], ['item-3', ['好']], ['ending', ['再見']]]);
  });
});

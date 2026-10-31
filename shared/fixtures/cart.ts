import type { CartItemInput } from '../cart';

/** Five made-up things a Muse might have noted while shopping; the stores are invented and the links point at example.com. */
export const fixtureCartItems: readonly CartItemInput[] = [
  { title: '手沖咖啡濾杯 陶瓷 02', store: '山嵐咖啡器材', url: 'https://example.com/shanlan/dripper-02', priceTwd: 650, category: 'kitchen', qty: 1 },
  { title: '無線降噪耳機', store: '青田電器行', url: 'https://example.com/qingtian/anc-headphones', priceTwd: 3990, category: 'electronics', qty: 1 },
  { title: '帆布托特包 燕麥色', store: '巷口布作', url: 'https://example.com/xiangkou/canvas-tote', priceTwd: 880, category: 'fashion', qty: 1 },
  { title: '鑄鐵平底鍋 24cm', store: '灶腳生活', url: 'https://example.com/zaojiao/cast-iron-24', priceTwd: 1580, category: 'kitchen', qty: 1 },
  { title: '繪本《月亮上的貓》', store: '小雨書店', url: 'https://example.com/xiaoyu/moon-cat', priceTwd: 360, category: 'books', qty: 1 },
];

import { formatTwd } from '../../shared/cart';
import type { ShareView } from '../../shared/share';
import { formatRange } from '../cart/shelf';
import { shownNickname, t } from '../i18n';
import type { RoomControls } from '../room/RoomScene';

/** The size link previews expect (Open Graph's 1.91:1). */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;
const CARD_BACKGROUND = '#fff7e9';

/** The words on the card, from the narrowed view: a price line only in the modes that show one. */
export function cardWords(view: ShareView) {
  const price = view.mode === 'range' && view.totalRange ? t('Total about {amount}', { amount: formatRange(view.totalRange) })
    : view.mode === 'exact' && view.totalTwd !== null ? t('Total {amount}', { amount: formatTwd(view.totalTwd) }) : null;
  return { brand: 'pacafe-cart-showroom', title: t("{nickname}'s cart showroom", { nickname: shownNickname(view.nickname) }), count: t('{count} things', { count: view.items.length }), price, note: t('Things their Muse noted while shopping') };
}

/** Breaks between CJK characters and between words, never before closing punctuation; the last line ends in … when the text runs over. */
function wrapText(text: string, width: number, lines: number, measure: (text: string) => number): string[] {
  const pieces = (text.match(/[\u3000-\u9fff\uff00-\uffef]|[^\s\u3000-\u9fff\uff00-\uffef]+\s*|\s+/g) ?? [])
    .flatMap(piece => measure(piece.trimEnd()) > width ? [...piece] : [piece]);
  const out: string[] = []; let line = '';
  for (const piece of pieces) {
    if (line && measure((line + piece).trimEnd()) > width && !/^[、。，．！？：；」』）】〉》,.!?:;)\]]/.test(piece)) { out.push(line.trimEnd()); line = piece.trimStart(); }
    else line += piece;
  }
  if (line.trim()) out.push(line.trimEnd());
  if (out.length <= lines) return out;
  let last = out[lines - 1];
  while (last && measure(`${last}…`) > width) last = [...last].slice(0, -1).join('');
  return [...out.slice(0, lines - 1), `${last.trimEnd()}…`];
}

const FONT = '"Nunito Sans Variable", "PingFang TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif';
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

function drawCardWords(paint: CanvasRenderingContext2D, words: ReturnType<typeof cardWords>) {
  const { width, height } = SHARE_CARD_SIZE, left = 64, column = 600;
  const wash = paint.createLinearGradient(0, 0, width * .78, 0);
  wash.addColorStop(0, 'rgba(34, 46, 38, .9)'); wash.addColorStop(.62, 'rgba(34, 46, 38, .62)'); wash.addColorStop(1, 'rgba(34, 46, 38, 0)');
  paint.fillStyle = wash; paint.fillRect(0, 0, width, height);
  paint.textBaseline = 'alphabetic'; paint.textAlign = 'left';
  const measure = (text: string) => paint.measureText(text).width;

  paint.font = font(900, 30); paint.fillStyle = '#c9e2b3';
  paint.fillText(words.brand, left, 84);

  let size = 74, title: string[] = [];
  for (; size >= 54; size -= 4) { paint.font = font(900, size); title = wrapText(words.title, column, 2, measure); if (title.length === 1) break; }
  size = Math.max(size, 54);
  paint.fillStyle = '#fffaf0';
  let y = 84 + 24;
  for (const line of title) { y += size * 1.08; paint.fillText(line, left, y); }

  paint.font = font(800, 40); paint.fillStyle = '#f0c9a8';
  y += 70; paint.fillText(words.count, left, y);
  if (words.price) { paint.font = font(900, 46); paint.fillStyle = '#b9f3a0'; y += 64; paint.fillText(wrapText(words.price, column, 1, measure)[0] ?? '', left, y); }

  paint.font = font(900, 30);
  const note = wrapText(words.note, width - left * 2 - 64, 1, measure)[0] ?? '', pill = measure(note) + 64, top = height - 64 - 68;
  paint.fillStyle = '#a9cf8f'; paint.beginPath(); paint.roundRect(left, top, pill, 68, 20); paint.fill();
  paint.lineWidth = 4; paint.strokeStyle = '#22362c'; paint.stroke();
  paint.fillStyle = '#22362c'; paint.fillText(note, left + 32, top + 45);
}

const jpeg = (canvas: HTMLCanvasElement) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));

async function drawCard(photo: CanvasImageSource, view: ShareView): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD_SIZE.width; canvas.height = SHARE_CARD_SIZE.height;
  const paint = canvas.getContext('2d');
  if (!paint) return null;
  paint.drawImage(photo, 0, 0, SHARE_CARD_SIZE.width, SHARE_CARD_SIZE.height);
  await document.fonts?.load(font(900, 40)).catch(() => undefined);
  drawCardWords(paint, cardWords(view));
  return jpeg(canvas);
}

/** The room shrunk and pushed right, so the words on the left cover the studio corner rather than the shelf. */
const ROOM_PLACE = { centre: .56, scale: .88 } as const;
function placeRoom(room: CanvasImageSource): HTMLCanvasElement {
  const { width, height } = SHARE_CARD_SIZE, w = width * ROOM_PLACE.scale, h = height * ROOM_PLACE.scale;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const paint = canvas.getContext('2d');
  if (paint) { paint.fillStyle = CARD_BACKGROUND; paint.fillRect(0, 0, width, height); paint.drawImage(room, width * ROOM_PLACE.centre - w / 2, (height - h) / 2, w, h); }
  return canvas;
}

/** A JPEG card of the room as it is drawn now, with the words from `view`; null when the room cannot be captured (still loading, or the 2D fallback). */
export async function shootCard(controls: RoomControls | null, view: ShareView): Promise<Blob | null> {
  const room = controls?.capture?.(SHARE_CARD_SIZE.width, SHARE_CARD_SIZE.height, CARD_BACKGROUND) ?? null;
  return room ? drawCard(placeRoom(room), view) : null;
}

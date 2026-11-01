import * as THREE from 'three';
import type { ImageLoader } from './productImage';
import { shelfColour, type ShelfItem } from './shelf';

export function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
export const font = (weight: number, size: number) => `${weight} ${size}px "Nunito Sans Variable", "PingFang TC", "Noto Sans TC", sans-serif`;
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number) {
  const out: string[] = []; let line = '';
  for (const char of text) {
    if (ctx.measureText(line + char).width > width && line) { out.push(line); line = ''; if (out.length === lines) break; }
    line += char;
  }
  if (out.length < lines && line) out.push(line);
  if (out.join('').length < text.length) out[out.length - 1] = `${out[out.length - 1].slice(0, -1)}…`;
  return out;
}

const PICTURE_RETRY_MS = 10_000;
const CARD_W = 320, PLAIN_H = 240, TEXT_H = 92;
/** The picture area takes the photo's own shape at the card's width, kept between a wide strip and a tall portrait; a photo past either limit is shown whole inside it. */
const PICTURE_MIN_H = 160, PICTURE_MAX_H = 400;
const pictureHeight = (picture: ImageBitmap) => Math.round(Math.min(PICTURE_MAX_H, Math.max(PICTURE_MIN_H, CARD_W * picture.height / picture.width)));

function paintCard(ctx: CanvasRenderingContext2D, item: ShelfItem, colour: string, picture: ImageBitmap | null) {
  const pictureH = picture ? pictureHeight(picture) : 0, cardH = picture ? pictureH + TEXT_H : PLAIN_H;
  ctx.clearRect(0, 0, CARD_W, cardH);
  ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.roundRect(0, 0, CARD_W, cardH, 26); ctx.fill();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (picture) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, CARD_W, pictureH, [26, 26, 0, 0]); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, pictureH);
    const scale = Math.min(CARD_W / picture.width, pictureH / picture.height), w = picture.width * scale, h = picture.height * scale;
    ctx.drawImage(picture, (CARD_W - w) / 2, (pictureH - h) / 2, w, h);
    ctx.restore();
    ctx.fillStyle = colour; ctx.fillRect(0, pictureH, CARD_W, 5);
    ctx.fillStyle = '#2f3d35'; ctx.font = font(800, 30);
    wrap(ctx, item.title, 288, 1).forEach(line => ctx.fillText(line, 16, pictureH + 12));
  } else {
    ctx.fillStyle = '#2f3d35'; ctx.font = font(800, 44);
    wrap(ctx, item.title, 288, 2).forEach((line, k) => ctx.fillText(line, 16, 18 + k * 52));
    ctx.fillStyle = colour; ctx.fillRect(16, 134, 288, 6);
  }
  const y = picture ? pictureH + 46 : 156, room = item.qty > 1 ? 210 : 288, max = picture ? 40 : 50;
  if (item.price !== null) {
    let size = max; ctx.fillStyle = '#9a4e2f'; ctx.font = font(900, size);
    while (size > 28 && ctx.measureText(item.price).width > room) { size -= 4; ctx.font = font(900, size); }
    ctx.fillText(item.price, 16, y + (max - size) / 2, room);
  }
  if (item.qty > 1) { ctx.textAlign = 'right'; ctx.fillStyle = '#2f3d35'; ctx.font = font(900, picture ? 38 : 44); ctx.fillText(`×${item.qty}`, 304, y + 4); }
}

/** Width over height of the plane `show` should draw a card on. */
export type CardShow = (texture: THREE.Texture, aspect: number) => void;

/** The largest card of this aspect that fits in `width` × `height`. */
export const fitCard = (aspect: number, width: number, height: number) => Math.min(width, height * aspect) === width ? { width, height: width / aspect } : { width: height * aspect, height };

/**
 * The product's picture card. It is shown at once without its picture, then again when the picture loads, in the picture's shape.
 * A texture's size is fixed once uploaded, so each showing is a new texture; the one it replaces is freed.
 */
export function cardFace(item: ShelfItem, show: CardShow, loadImage?: ImageLoader, labelScale = 1) {
  const colour = shelfColour(item);
  const paint = (picture: ImageBitmap | null) => {
    const height = picture ? pictureHeight(picture) + TEXT_H : PLAIN_H;
    return { texture: canvasTexture(CARD_W * labelScale, height * labelScale, ctx => { ctx.scale(labelScale, labelScale); paintCard(ctx, item, colour, picture); }), aspect: CARD_W / height };
  };
  let shown = paint(null), disposed = false;
  show(shown.texture, shown.aspect);
  const fetchPicture = (retries: number) => void loadImage!(item.image!).then(picture => {
    if (disposed) return;
    if (!picture) { if (retries) setTimeout(() => { if (!disposed) fetchPicture(retries - 1); }, PICTURE_RETRY_MS); return; }
    const before = shown; shown = paint(picture);
    show(shown.texture, shown.aspect); before.texture.dispose();
  });
  if (item.image && loadImage) fetchPicture(2);
  return { dispose() { disposed = true; shown.texture.dispose(); } };
}

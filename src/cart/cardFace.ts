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
const CARD_W = 320, CARD_H = 240, PICTURE_H = 148;

function paintCard(ctx: CanvasRenderingContext2D, item: ShelfItem, colour: string, picture: ImageBitmap | null) {
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.roundRect(0, 0, CARD_W, CARD_H, 26); ctx.fill();
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (picture) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, CARD_W, PICTURE_H, [26, 26, 0, 0]); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CARD_W, PICTURE_H);
    const scale = Math.max(CARD_W / picture.width, PICTURE_H / picture.height), w = picture.width * scale, h = picture.height * scale;
    ctx.drawImage(picture, (CARD_W - w) / 2, (PICTURE_H - h) / 2, w, h);
    ctx.restore();
    ctx.fillStyle = colour; ctx.fillRect(0, PICTURE_H, CARD_W, 5);
    ctx.fillStyle = '#2f3d35'; ctx.font = font(800, 30);
    wrap(ctx, item.title, 288, 1).forEach(line => ctx.fillText(line, 16, PICTURE_H + 12));
  } else {
    ctx.fillStyle = '#2f3d35'; ctx.font = font(800, 44);
    wrap(ctx, item.title, 288, 2).forEach((line, k) => ctx.fillText(line, 16, 18 + k * 52));
    ctx.fillStyle = colour; ctx.fillRect(16, 134, 288, 6);
  }
  const y = picture ? PICTURE_H + 46 : 156, room = item.qty > 1 ? 210 : 288, max = picture ? 40 : 50;
  if (item.price !== null) {
    let size = max; ctx.fillStyle = '#9a4e2f'; ctx.font = font(900, size);
    while (size > 28 && ctx.measureText(item.price).width > room) { size -= 4; ctx.font = font(900, size); }
    ctx.fillText(item.price, 16, y + (max - size) / 2, room);
  }
  if (item.qty > 1) { ctx.textAlign = 'right'; ctx.fillStyle = '#2f3d35'; ctx.font = font(900, picture ? 38 : 44); ctx.fillText(`×${item.qty}`, 304, y + 4); }
}

/** The product's picture card, painted at once and repainted when its picture loads. */
export function cardFace(item: ShelfItem, loadImage?: ImageLoader, labelScale = 1) {
  const colour = shelfColour(item);
  const texture = canvasTexture(CARD_W * labelScale, CARD_H * labelScale, ctx => { ctx.scale(labelScale, labelScale); paintCard(ctx, item, colour, null); });
  const ctx = (texture.image as HTMLCanvasElement).getContext('2d')!;
  let disposed = false;
  const fetchPicture = (retries: number) => void loadImage!(item.image!).then(picture => {
    if (disposed) return;
    if (!picture) { if (retries) setTimeout(() => { if (!disposed) fetchPicture(retries - 1); }, PICTURE_RETRY_MS); return; }
    paintCard(ctx, item, colour, picture); texture.needsUpdate = true;
  });
  if (item.image && loadImage) fetchPicture(2);
  return { texture, aspect: CARD_W / CARD_H, dispose() { disposed = true; texture.dispose(); } };
}


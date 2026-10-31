import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { z } from 'zod';
import type { CartItem } from '../../shared/cart';
import { packagingOf, STICKERS, type StickerId } from '../../shared/packaging';
import { readStoredJson, writeStored } from '../browserStorage';
import { t } from '../i18n';
import type { TextKey } from '../i18n/messages';
import '../share/share.css';
import './stickers.css';

const META: Record<StickerId, { emoji: string; name: TextKey }> = {
  star: { emoji: '⭐', name: 'Gold star' }, clover: { emoji: '🍀', name: 'Lucky clover' }, cat: { emoji: '🐱', name: 'Counter cat' }, rainbow: { emoji: '🌈', name: 'Rainbow' },
  moon: { emoji: '🌙', name: 'Night moon' }, berry: { emoji: '🍓', name: 'Strawberry' }, rocket: { emoji: '🚀', name: 'Little rocket' }, bear: { emoji: '🧸', name: 'Teddy bear' },
};
export const stickerName = (id: StickerId) => t(META[id].name);

export const Sticker = ({ id }: { id: StickerId }) => <span className="sticker" data-sticker={id} role="img" aria-label={stickerName(id)}><span aria-hidden="true">{META[id].emoji}</span></span>;

const KEY = 'showroom.stickers';
const collectedSchema = z.record(z.string(), z.strictObject({ sticker: z.enum(STICKERS), title: z.string() }));
type Collected = z.infer<typeof collectedSchema>;
const readCollected = (): Collected => { const parsed = collectedSchema.safeParse(readStoredJson(KEY)); return parsed.success ? parsed.data : {}; };

/** Remembered in this browser, so a sticker stays in the album after its item leaves the cart. */
export function useStickers(items: readonly CartItem[], shelved: ReadonlySet<string>) {
  const [collected, setCollected] = useState(readCollected);
  useEffect(() => {
    const fresh = items.filter(item => shelved.has(item.id) && packagingOf(item).sticker && !collected[item.id]);
    if (!fresh.length) return;
    const next = { ...collected, ...Object.fromEntries(fresh.map(item => [item.id, { sticker: packagingOf(item).sticker!, title: item.title }])) };
    writeStored(KEY, JSON.stringify(next)); setCollected(next);
  }, [items, shelved, collected]);
  return useMemo(() => STICKERS.map(id => ({ id, from: Object.values(collected).filter(entry => entry.sticker === id).map(entry => entry.title) })), [collected]);
}
export type StickerBook = ReturnType<typeof useStickers>;
export const foundCount = (book: StickerBook) => book.filter(page => page.from.length).length;

export function StickerAlbum({ book, close }: { book: StickerBook; close: () => void }) {
  const found = foundCount(book);
  return <section className="share-panel album" id="album-panel" aria-labelledby="album-title" data-testid="album-panel">
    <header className="share-panel-head">
      <h2 id="album-title">{t('Sticker album')}</h2>
      <button type="button" className="share-icon-button" onClick={close} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
    </header>
    <p className="cart-note" data-testid="album-count">{t('{found} of {total} stickers found. About one parcel in four has one tucked inside.', { found, total: book.length })}</p>
    <ul className="album-grid" aria-label={t('Sticker album')}>
      {book.map(({ id, from }, slot) => <li key={id} data-found={from.length > 0} data-testid="album-slot" style={{ '--tilt': `${[-4, 3, -2, 5, -5, 2, -3, 4][slot]}deg` } as React.CSSProperties} title={from.length ? from.join(' · ') : undefined}>
        {from.length ? <><Sticker id={id} />{from.length > 1 && <b className="album-count">×{from.length}</b>}<small>{stickerName(id)}</small></> : <><span className="sticker-blank" aria-hidden="true">?</span><small>{t('Not found yet')}</small></>}
      </li>)}
    </ul>
  </section>;
}

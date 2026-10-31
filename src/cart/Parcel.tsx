import type { CSSProperties, ReactNode } from 'react';
import { ExternalLink, Scissors } from 'lucide-react';
import type { Rarity } from '../../shared/packaging';
import { t } from '../i18n';
import { ProductThumb } from './ProductThumb';
import { Sticker } from './stickers';
import type { TrayItem } from './trayItem';
import { STAGGERED, type Box } from './unbox';
import './unbox-tray.css';
import './stickers.css';

export const style = (vars: Record<string, string | number>) => vars as CSSProperties;

/** A parcel drawn in CSS; the same art is the big one on the counter, a small one waiting in line, and the one popping open. */
export function Parcel({ box, item, index = 0, variant, rarity, children }: { box: Box; item: TrayItem; index?: number; variant: 'front' | 'mini'; rarity?: Rarity; children?: ReactNode }) {
  return <div className={`parcel parcel-${variant}`} data-testid="unbox-box" data-item-id={box.id} data-phase={box.phase} data-box={item.packaging.box} data-tape={item.packaging.tape} data-filler={item.packaging.filler} data-progress={box.phase === 'slicing' ? box.progress.toFixed(2) : undefined} data-rarity={rarity}
    style={style({ '--p': box.phase === 'slicing' ? box.progress : 0, '--i': Math.min(index, STAGGERED) })} aria-label={variant === 'mini' ? t('Parcel waiting its turn') : undefined}>
    <i className="parcel-inside" /><i className="parcel-filler" /><i className="flap flap-back" /><i className="flap flap-front" />
    <div className="parcel-body">{item.store && <span className="parcel-label">{t('From {store}', { store: item.store })}</span>}</div>
    <div className="parcel-tape" data-testid={variant === 'front' ? 'unbox-tape' : undefined}><i className="parcel-cut" /></div>
    {variant === 'front' && <Scissors className="parcel-scissors" aria-hidden="true" />}
    {children}
  </div>;
}


/** Where a thing ends its reveal, as an offset from where it sits in its parcel: the centre of `.{target}`, or straight up when the page has none. */
export function flyTo(target: string) {
  return (node: HTMLElement | null) => {
    const shelf = document.querySelector(target)?.getBoundingClientRect(), from = node?.parentElement?.getBoundingClientRect();
    if (!node || !shelf?.width || !from) return;
    node.style.setProperty('--fx', `${shelf.left + shelf.width / 2 - (from.left + from.width / 2)}px`);
    node.style.setProperty('--fy', `${shelf.top + shelf.height / 2 - (from.top + node.offsetHeight / 2)}px`);
  };
}
export const flyToShelf = flyTo('.shelf-target'), flyToAlbum = flyTo('.album-target');

/** What comes out of an opened parcel: its picture (or a tile), title, store, price, the link to the product page, and Muse's handwritten note when it left one. */
export function RevealCard({ item, still = false }: { item: TrayItem; /** Sits where it is, readable, instead of flying out of a parcel. */ still?: boolean }) {
  return <span className={still ? 'parcel-item parcel-item-still' : 'parcel-item'} ref={still ? undefined : flyToShelf} data-testid="unbox-reveal">
    {item.note && <span className="parcel-note" data-testid="unbox-note"><i aria-hidden="true" />{item.note}</span>}
    <ProductThumb src={item.picture} category={item.category} className="parcel-item-pic" eager />
    <b>{item.title}{item.qty > 1 && <small>×{item.qty}</small>}</b>
    <span className="parcel-item-more">
      <span className="parcel-item-from">{item.store && <small>{item.store}</small>}{item.price && <strong>{item.price}</strong>}</span>
      {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" data-testid="unbox-reveal-link">{t('View item')}<ExternalLink size={11} aria-hidden="true" /></a>}
    </span>
  </span>;
}

/** The sticker that was tucked in the box: it pops beside the card, then flies to the album. */
export const RevealSticker = ({ id }: { id: NonNullable<TrayItem['packaging']['sticker']> }) => <span className="parcel-sticker" ref={flyToAlbum} data-testid="unbox-sticker"><Sticker id={id} /><i className="twinkle" style={style({ '--x': '-1.6em', '--y': '-1.2em' })} /><i className="twinkle" style={style({ '--x': '1.8em', '--y': '-.6em', '--d': '.35s' })} /><i className="twinkle" style={style({ '--x': '.2em', '--y': '1.9em', '--d': '.7s' })} /></span>;



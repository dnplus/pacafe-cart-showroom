import { useState, type CSSProperties } from 'react';
import type { CartCategory } from '../../shared/cart';
import { categoryHue, categoryIcon } from './category';

/** Cross-origin store images are asked for without a Referer, which is what most hotlink checks look at. */
export function ProductThumb({ src, category = null, className = '', eager = false }: { src: string | null; category?: CartCategory | null; className?: string; /** For a picture about to be seen at once: a lazy one would load only after it is already on screen. */ eager?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  const Icon = categoryIcon(category);
  const shown = src !== null && broken !== src;
  return <span className={`product-thumb ${className}`} data-has-image={shown} aria-hidden="true" style={{ '--hue': categoryHue(category) } as CSSProperties}>
    {shown ? <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(src)} /> : <Icon size={20} strokeWidth={1.8} />}
  </span>;
}

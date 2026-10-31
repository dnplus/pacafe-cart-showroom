import { useEffect, useState } from 'react';
import { PRODUCT_POKED } from './cartScene';

/** `n` changes on every click, so clicking the same product again counts. */
export interface ProductFocus { key: string; n: number }

export function useProductPoke(): ProductFocus | null {
  const [focus, setFocus] = useState<ProductFocus | null>(null);
  useEffect(() => {
    let n = 0;
    const poked = (event: Event) => { const key = (event as CustomEvent<{ key?: unknown }>).detail?.key; if (typeof key === 'string') setFocus({ key, n: ++n }); };
    document.addEventListener(PRODUCT_POKED, poked);
    return () => document.removeEventListener(PRODUCT_POKED, poked);
  }, []);
  return focus;
}

const FLASH_MS = 2200;

export function useFlashedLine(focus: ProductFocus | null, ready: boolean, list: () => HTMLElement | null) {
  const [flashed, setFlashed] = useState<string | null>(null);
  useEffect(() => {
    if (!focus || !ready) return;
    const line = [...(list()?.children ?? [])].find(node => (node as HTMLElement).dataset.key === focus.key);
    if (!line) return;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    line.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    setFlashed(focus.key);
    const timer = setTimeout(() => setFlashed(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [focus, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return flashed;
}

import { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { t } from '../i18n';
import type { TrayItem } from './trayItem';
import type { ProductFocus } from './useProductPoke';
import './stickers.css';

const OFFER_MS = 7000;

export function ReplayOffer({ focus, items, shelved, idOf, start }: { focus: ProductFocus | null; items: readonly TrayItem[]; shelved: ReadonlySet<string>; idOf: (key: string) => string | undefined; start: (id: string) => void }) {
  const [offered, setOffered] = useState<string | null>(null);
  useEffect(() => {
    const id = focus && idOf(focus.key);
    if (!id || !shelved.has(id)) return;
    setOffered(id);
    const timer = setTimeout(() => setOffered(null), OFFER_MS);
    return () => clearTimeout(timer);
  }, [focus]);
  const item = offered === null ? undefined : items.find(entry => entry.id === offered);
  if (!item) return null;
  return <div className="replay-offer" role="status" data-testid="replay-offer">
    <span>{item.title}</span>
    <button type="button" className="replay-go" onClick={() => { setOffered(null); start(item.id); }} data-testid="replay-go"><RotateCcw size={15} aria-hidden="true" />{t('Unbox again')}</button>
    <button type="button" className="replay-x" onClick={() => setOffered(null)} aria-label={t('Close')}><X size={15} aria-hidden="true" /></button>
  </div>;
}

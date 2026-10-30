import { ChevronDown, ChevronUp, ShoppingBasket } from 'lucide-react';
import { cartView, formatTwd } from '../../shared/cart';
import { t } from '../i18n';
import type { CartState } from './useCart';
import './cart.css';

export function CartHud({ state, open, onToggle }: { state: CartState; open: boolean; onToggle: () => void }) {
  const items = state.status === 'loading' ? [] : state.cart?.items ?? [];
  const view = cartView(items), percent = Math.round(view.fill * 100);
  return <aside className="cart-hud" aria-label={t('Cart showroom')} data-testid="cart-hud" data-count={view.count} data-total={view.totalTwd} data-fill={view.fill}>
    <header className="cart-hud-head">
      <span className="cart-hud-mark" aria-hidden="true"><ShoppingBasket size={18} /></span>
      <span><strong>{t('Cart showroom')}</strong><small>{t('Things your Muse noted while shopping')}</small></span>
    </header>
    <dl className="cart-stats">
      <div><dt>{t('Items')}</dt><dd data-testid="hud-count">{view.count}</dd></div>
      <div><dt>{t('Total')}</dt><dd data-testid="hud-total">{formatTwd(view.totalTwd)}</dd></div>
      <div><dt>{t('Shelf filled')}</dt><dd data-testid="hud-fill">{percent}%</dd>
        <span className="cart-fill" role="meter" aria-label={t('Shelf filled')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></span></div>
    </dl>
    {view.overflow > 0 && <p className="cart-note">{t('{count} more do not fit on the shelf', { count: view.overflow })}</p>}
    {state.status === 'loading' && <p className="cart-note" role="status">{t('Loading the cart…')}</p>}
    {state.status === 'offline' && <p className="cart-note cart-offline" role="status">{t('Cannot reach the cart right now. Trying again.')}</p>}
    {state.status !== 'loading' && !view.count && <p className="cart-note">{t('The shelf is empty. What your Muse notes while shopping shows up here.')}</p>}
    {view.count > 0 && <button type="button" className="cart-toggle" aria-expanded={open} aria-controls="cart-list" onClick={onToggle}>{open ? t('Hide the list') : t('Show the list')}{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</button>}
    {open && view.count > 0 && <ol className="cart-list" id="cart-list" aria-label={t('On the shelf')}>
      {items.map(item => <li key={item.id}>
        <span className="cart-line-title">{item.title}{item.store && <small>{item.store}</small>}</span>
        <span className="cart-line-price">{item.priceTwd === null ? t('No price') : formatTwd(item.priceTwd)}{item.qty > 1 && <small>×{item.qty}</small>}</span>
      </li>)}
    </ol>}
    <p className="cart-disclaimer">{t('No checkout and no link to Muse shopping: your own Muse does the shopping, this room only shows it.')}</p>
  </aside>;
}

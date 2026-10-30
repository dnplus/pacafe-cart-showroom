import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Package, ShoppingBasket } from 'lucide-react';
import { formatTwd } from '../../shared/cart';
import { shareViewSchema, type ShareView } from '../../shared/share';
import { formatRange, sharedShelf } from '../cart/shelf';
import { RoomZones } from '../components/RoomZones';
import { t } from '../i18n';
import { RoomScene } from '../room/RoomScene';
import { showroomStudioSet } from '../room/studioSet';
import '../cart/cart.css';
import './share.css';

type Load = { status: 'loading' } | { status: 'ready'; view: ShareView } | { status: 'missing' } | { status: 'failed' };

const priceOf = (item: ShareView['items'][number]) => 'priceRange' in item ? item.priceRange ? formatRange(item.priceRange) : t('No price')
  : 'priceTwd' in item ? item.priceTwd === null ? t('No price') : formatTwd(item.priceTwd) : null;
const totalOf = (view: ShareView) => view.mode === 'range' ? view.totalRange ? formatRange(view.totalRange) : '—' : view.mode === 'exact' ? view.totalTwd === null ? '—' : formatTwd(view.totalTwd) : null;

function Thumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  return <span className="share-thumb" aria-hidden="true">{src && !broken ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <Package size={18} />}</span>;
}

function SharePanel({ view, open, onToggle }: { view: ShareView; open: boolean; onToggle: () => void }) {
  const total = totalOf(view);
  return <aside className="cart-hud share-hud" aria-label={t("{nickname}'s cart showroom", { nickname: view.nickname })} data-testid="share-hud" data-mode={view.mode}>
    <header className="cart-hud-head">
      <span className="cart-hud-mark" aria-hidden="true"><ShoppingBasket size={18} /></span>
      <span><h1>{t("{nickname}'s cart showroom", { nickname: view.nickname })}</h1><small>{t('Things their Muse noted while shopping')}</small></span>
    </header>
    <dl className={`cart-stats ${total === null ? 'share-stats-count' : 'share-stats'}`}>
      <div><dt>{t('Items')}</dt><dd data-testid="share-count">{view.items.length}</dd></div>
      {total !== null && <div><dt>{t('Total')}</dt><dd data-testid="share-total">{total}</dd></div>}
    </dl>
    {view.items.length > 0 && <button type="button" className="cart-toggle" aria-expanded={open} aria-controls="share-list" onClick={onToggle}>{open ? t('Hide the list') : t('Show the list')}{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</button>}
    {open && view.items.length > 0 && <ol className="cart-list share-list" id="share-list" aria-label={t('On the shelf')}>
      {view.items.map((item, slot) => { const price = priceOf(item); return <li key={slot}>
        <Thumb src={item.imageUrl} />
        <span className="cart-line-title">{item.title}{item.url && <a href={item.url} target="_blank" rel="noreferrer noopener">{t('View item')}<ExternalLink size={12} aria-hidden="true" /></a>}</span>
        {(price !== null || item.qty > 1) && <span className="cart-line-price">{price}{item.qty > 1 && <small>×{item.qty}</small>}</span>}
      </li>; })}
    </ol>}
    <p className="cart-disclaimer">{t("No checkout here, and this is not part of Muse shopping: it only shows what the owner's Muse noted.")}</p>
  </aside>;
}

/** The visitor's page at /s/<slug>: the owner's room, read-only, drawn from the narrowed view the worker answers with. */
export function Showcase({ slug }: { slug: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [listOpen, setListOpen] = useState(() => typeof matchMedia !== 'function' || matchMedia('(min-width: 901px)').matches);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/s/${slug}`, { headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal })
      .then(async response => setLoad(response.status === 404 ? { status: 'missing' } : response.ok ? { status: 'ready', view: shareViewSchema.parse(await response.json()) } : { status: 'failed' }))
      .catch(error => { if (!controller.signal.aborted) { console.warn(error); setLoad({ status: 'failed' }); } });
    return () => controller.abort();
  }, [slug]);
  const shelf = useMemo(() => load.status === 'ready' ? sharedShelf(load.view) : null, [load]);
  useEffect(() => { if (load.status === 'ready') document.title = t("{nickname}'s cart showroom", { nickname: load.view.nickname }); }, [load]);

  if (load.status === 'missing' || load.status === 'failed') return <main className="agent-house-app share-missing-page">
    <section className="share-missing" role="alert">
      <span className="cart-hud-mark" aria-hidden="true"><ShoppingBasket size={18} /></span>
      <p>{t(load.status === 'missing' ? 'This share link does not exist or has been turned off.' : 'Cannot load this share right now. Try again later.')}</p>
    </section>
  </main>;
  return <main className="agent-house-app showroom share-page">
    {load.status === 'ready' ? <SharePanel view={load.view} open={listOpen} onToggle={() => setListOpen(open => !open)} />
      : <aside className="cart-hud share-hud"><p className="cart-note" role="status">{t('Loading the shared cart…')}</p></aside>}
    <section className="world-stage game-stage" aria-label={t('Cart showroom')}>
      <RoomZones>
        <RoomScene scenery="peach" shelf={shelf} counter={() => setListOpen(true)} baristaName={t('Clerk')} owner={load.status === 'ready' ? { name: load.view.nickname, sprite: null } : undefined} studioSet={showroomStudioSet} hour={14} />
      </RoomZones>
    </section>
  </main>;
}

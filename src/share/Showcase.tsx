import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, RotateCcw, ShoppingBasket } from 'lucide-react';
import { formatTwd } from '../../shared/cart';
import { shareViewSchema, type ShareView } from '../../shared/share';
import { ProductThumb } from '../cart/ProductThumb';
import { visitorImageLoader } from '../cart/productImage';
import { formatRange, sharedShelf } from '../cart/shelf';
import { ReplayOffer } from '../cart/ReplayOffer';
import { visitorKeys, visitorTrayItems } from '../cart/trayItem';
import { ReplayTray, UnboxTray } from '../cart/UnboxTray';
import { useFlashedLine, useProductPoke, type ProductFocus } from '../cart/useProductPoke';
import { RoomZones } from '../components/RoomZones';
import { shownNickname, t } from '../i18n';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { RoomScene } from '../room/RoomScene';
import { showroomStudioSet } from '../room/studioSet';
import { useVisitorUnbox } from './useVisitorUnbox';
import '../cart/cart.css';
import './share.css';

type Load = { status: 'loading' } | { status: 'ready'; view: ShareView } | { status: 'missing' } | { status: 'failed' };

const priceOf = (item: ShareView['items'][number]) => 'priceRange' in item ? item.priceRange ? formatRange(item.priceRange) : t('No price')
  : 'priceTwd' in item ? item.priceTwd === null ? t('No price') : formatTwd(item.priceTwd) : null;
const totalOf = (view: ShareView) => view.mode === 'range' ? view.totalRange ? formatRange(view.totalRange) : '—' : view.mode === 'exact' ? view.totalTwd === null ? '—' : formatTwd(view.totalTwd) : null;

function SharePanel({ view, open, onToggle, focus, opened, replay }: { view: ShareView; open: boolean; onToggle: () => void; focus: ProductFocus | null; /** Slots this visitor has unboxed; those lines offer to unbox again. */ opened: ReadonlySet<number>; replay: (slot: number) => void }) {
  const total = totalOf(view), list = useRef<HTMLOListElement>(null), flashed = useFlashedLine(focus, open, () => list.current);
  return <aside className="cart-hud share-hud" aria-label={t("{nickname}'s cart showroom", { nickname: shownNickname(view.nickname) })} data-testid="share-hud" data-mode={view.mode}>
    <header className="cart-hud-head">
      <span className="cart-hud-mark" aria-hidden="true"><ShoppingBasket size={18} /></span>
      <span><h1>{t("{nickname}'s cart showroom", { nickname: shownNickname(view.nickname) })}</h1><small>{t('Things their Muse noted while shopping')}</small></span>
      <LanguageSwitch />
    </header>
    <dl className={`cart-stats ${total === null ? 'share-stats-count' : 'share-stats'}`}>
      <div><dt>{t('Items')}</dt><dd data-testid="share-count">{view.items.length}</dd></div>
      {total !== null && <div><dt>{t('Total')}</dt><dd data-testid="share-total">{total}</dd></div>}
    </dl>
    {view.items.length > 0 && <button type="button" className="cart-toggle" aria-expanded={open} aria-controls="share-list" onClick={onToggle}>{open ? t('Hide the list') : t('Show the list')}{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</button>}
    {open && view.items.length > 0 && <ol className="cart-list share-list" id="share-list" ref={list} aria-label={t('On the shelf')}>
      {view.items.map((item, slot) => { const price = priceOf(item); return <li key={slot} data-key={String(slot)} data-testid="share-row" className={flashed === String(slot) ? 'is-flashed' : undefined}>
        <ProductThumb src={item.imageUrl} />
        <span className="cart-line-main">
          {item.url
            ? <a className="cart-line-title cart-line-link" href={item.url} target="_blank" rel="noreferrer noopener" data-testid="share-row-link">{item.title}<ExternalLink size={12} aria-hidden="true" /></a>
            : <span className="cart-line-title">{item.title}</span>}
        </span>
        {(price !== null || item.qty > 1) && <span className="cart-line-price">{price}{item.qty > 1 && <small>×{item.qty}</small>}</span>}
        {opened.has(slot) && <button type="button" className="cart-replay" aria-label={t('Unbox {title} again', { title: item.title })} title={t('Unbox again')} onClick={() => replay(slot)} data-testid="share-replay"><RotateCcw size={15} aria-hidden="true" /></button>}
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
  const view = load.status === 'ready' ? load.view : null;
  const keys = useMemo(() => view ? visitorKeys(view) : null, [view]);
  const trayItems = useMemo(() => view ? visitorTrayItems(view) : [], [view]);
  // Each visitor unboxes their own parcels; what they opened stays in their browser and never reaches the owner's record.
  const unbox = useVisitorUnbox(slug, keys);
  const slots = useMemo(() => ({ opened: new Set(keys?.flatMap((key, slot) => unbox.shelved.has(key) ? [slot] : [])), landed: new Set(keys?.flatMap((key, slot) => unbox.landed.has(key) ? [slot] : [])) }), [keys, unbox.shelved, unbox.landed]);
  const loader = useMemo(() => visitorImageLoader(slug), [slug]);
  const shelf = useMemo(() => view ? sharedShelf(view, loader, slots) : null, [view, loader, slots]);
  const poked = useProductPoke();
  const [replaying, setReplaying] = useState<{ id: string; n: number } | null>(null);
  const replayItem = replaying && trayItems.find(item => item.id === replaying.id);
  const startReplay = useCallback((id: string) => setReplaying(previous => ({ id, n: (previous?.n ?? 0) + 1 })), []);
  const endReplay = useCallback(() => setReplaying(null), []);
  useEffect(() => { if (load.status === 'ready') document.title = t("{nickname}'s cart showroom", { nickname: shownNickname(load.view.nickname) }); }, [load]);

  if (load.status === 'missing' || load.status === 'failed') return <main className="agent-house-app share-missing-page">
    <section className="share-missing" role="alert">
      <span className="cart-hud-mark" aria-hidden="true"><ShoppingBasket size={18} /></span>
      <p>{t(load.status === 'missing' ? 'This share link does not exist or has been turned off.' : 'Cannot load this share right now. Try again later.')}</p>
    </section>
  </main>;
  return <main className="agent-house-app showroom share-page">
    {load.status === 'ready' ? <SharePanel view={load.view} open={listOpen} onToggle={() => setListOpen(open => !open)} focus={poked} opened={slots.opened} replay={slot => startReplay(keys![slot])} />
      : <aside className="cart-hud share-hud"><p className="cart-note" role="status">{t('Loading the shared cart…')}</p></aside>}
    <section className="world-stage game-stage" aria-label={t('Cart showroom')}>
      <RoomZones>
        <RoomScene scenery="peach" shelf={shelf} counter={() => setListOpen(true)} baristaName={t('Clerk')} owner={load.status === 'ready' ? { name: shownNickname(load.view.nickname), sprite: null } : undefined} studioSet={showroomStudioSet} hour={14} />
      </RoomZones>
    </section>
    {replayItem ? <ReplayTray key={replaying!.n} item={replayItem} done={endReplay} loadImage={loader} /> : <UnboxTray {...unbox} items={trayItems} loadImage={loader} />}
    {!replayItem && <ReplayOffer focus={poked} items={trayItems} shelved={unbox.shelved} idOf={key => keys?.[Number(key)]} start={startReplay} />}
  </main>;
}

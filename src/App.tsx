import { useMemo, useRef, useState } from 'react';
import { DEFAULT_CHARACTER } from '../shared/cast';
import { DEFAULT_NICKNAME } from '../shared/share';
import { sharePath, shareView, type ShareSettings } from '../shared/share';
import { CastPanel } from './cast/CastPanel';
import { useCast } from './cast/useCast';
import { useCue } from './cast/useCue';
import { CartHud } from './cart/CartHud';
import { UnboxTray } from './cart/UnboxTray';
import { ownerImageLoader } from './cart/productImage';
import { ownerShelf, sharedShelf } from './cart/shelf';
import { useCart } from './cart/useCart';
import { useProductPoke } from './cart/useProductPoke';
import { useUnbox } from './cart/useUnbox';
import { RoomZones } from './components/RoomZones';
import { t } from './i18n';
import { saveOwnerKey } from './owner';
import { HabitsPanel } from './habits/HabitsPanel';
import { PromoPanel } from './promo/PromoPanel';
import { RoomScene, type RoomControls } from './room/RoomScene';
import { showroomStudioSet } from './room/studioSet';
import { SharingSettings } from './share/SharingSettings';
import { Showcase } from './share/Showcase';

/** /s/<slug> is a visitor's page and never reads /api/cart; every other path is the owner's room. */
export default function App() {
  const slug = sharePath.exec(location.pathname)?.[1];
  return slug ? <Showcase slug={slug} /> : <Showroom />;
}

function Showroom() {
  const { state, retry } = useCart();
  const [listOpen, setListOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [casting, setCasting] = useState(false);
  const [habiting, setHabiting] = useState(false);
  const [preview, setPreview] = useState<ShareSettings | null>(null);
  const controls = useRef<RoomControls>(null);
  const cart = state.status === 'ready' || state.status === 'offline' ? state.cart : null;
  const cast = useCast(state.status === 'ready' || state.status === 'offline', sharing);
  const unbox = useUnbox(cart);
  const cue = useCue(cart, unbox.shelved.size, unbox.ready && cart?.items.length === unbox.boxes.length);
  const poked = useProductPoke();
  // While the share panel is open the room draws what a visitor would see, so the card it captures shows no more than that.
  const shelf = useMemo(() => !cart ? null : preview ? sharedShelf(shareView(cart, preview), ownerImageLoader) : ownerShelf(cart, unbox.shelved, unbox.landed), [cart, preview, unbox.shelved, unbox.landed]);
  return <main className="agent-house-app showroom">
    <CartHud state={state} open={listOpen} onToggle={() => setListOpen(open => !open)} unlock={key => { saveOwnerKey(key); retry(); }} focus={poked} sharing={sharing} onShare={() => { setSharing(open => !open); setCasting(false); setHabiting(false); }} casting={casting} onCast={() => { setCasting(open => !open); setSharing(false); setHabiting(false); }} habits={habiting} onHabits={() => { setHabiting(open => !open); setSharing(false); setCasting(false); }}>
      {habiting && <HabitsPanel cart={cart} close={() => setHabiting(false)} />}
      {casting && <CastPanel cast={cast} close={() => setCasting(false)} />}
      {sharing && <SharingSettings cart={cart} controls={controls} onPreview={setPreview} close={() => setSharing(false)} />}
      <PromoPanel count={cart?.items.length ?? 0} />
    </CartHud>
    <section className="world-stage game-stage" aria-label={t('Cart showroom')}>
      <RoomZones>
        <RoomScene scenery="peach" cue={preview ? null : cue} shelf={shelf} controls={controls} counter={() => setListOpen(true)} baristaName={t('Clerk')} barista={preview ? DEFAULT_CHARACTER : cast.view?.character} owner={{ name: preview?.nickname ?? cast.view?.nickname ?? DEFAULT_NICKNAME, sprite: preview ? null : cast.spriteUrl, open: () => { setCasting(true); setSharing(false); } }} studioSet={showroomStudioSet} hour={14} />
      </RoomZones>
    </section>
    {!sharing && !casting && !habiting && <UnboxTray {...unbox} items={cart?.items ?? []} />}
  </main>;
}

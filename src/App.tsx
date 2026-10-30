import { useMemo, useRef, useState } from 'react';
import { sharePath, shareView, type ShareSettings } from '../shared/share';
import { CartHud } from './cart/CartHud';
import { ownerShelf, sharedShelf } from './cart/shelf';
import { useCart } from './cart/useCart';
import { RoomZones } from './components/RoomZones';
import { t } from './i18n';
import { saveOwnerKey } from './owner';
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
  const [preview, setPreview] = useState<ShareSettings | null>(null);
  const controls = useRef<RoomControls>(null);
  const cart = state.status === 'ready' || state.status === 'offline' ? state.cart : null;
  // While the share panel is open the room draws what a visitor would see, so the card it captures shows no more than that.
  const shelf = useMemo(() => !cart ? null : preview ? sharedShelf(shareView(cart, preview)) : ownerShelf(cart), [cart, preview]);
  return <main className="agent-house-app showroom">
    <CartHud state={state} open={listOpen} onToggle={() => setListOpen(open => !open)} unlock={key => { saveOwnerKey(key); retry(); }} sharing={sharing} onShare={() => setSharing(open => !open)}>
      {sharing && <SharingSettings cart={cart} controls={controls} onPreview={setPreview} close={() => setSharing(false)} />}
    </CartHud>
    <section className="world-stage game-stage" aria-label={t('Cart showroom')}>
      <RoomZones>
        <RoomScene scenery="peach" shelf={shelf} controls={controls} counter={() => setListOpen(true)} baristaName={t('Clerk')} studioSet={showroomStudioSet} hour={14} />
      </RoomZones>
    </section>
  </main>;
}

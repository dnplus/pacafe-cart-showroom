import { useMemo, useState } from 'react';
import type { StudioSet } from '../shared/studio';
import { CartHud } from './cart/CartHud';
import { ownerShelf } from './cart/shelf';
import { useCart } from './cart/useCart';
import { RoomZones } from './components/RoomZones';
import { t } from './i18n';
import { RoomScene } from './room/RoomScene';

/** The presenter set stands left of the counter; scripts/generate-studio-set.mjs builds its model. */
const studioSet: StudioSet = { preset: 'presenter', x: -2.6, z: -3.3 };

export default function App() {
  const state = useCart();
  const [listOpen, setListOpen] = useState(false);
  const cart = state.status === 'loading' ? null : state.cart;
  const shelf = useMemo(() => cart ? ownerShelf(cart) : null, [cart]);
  return <main className="agent-house-app showroom">
    <CartHud state={state} open={listOpen} onToggle={() => setListOpen(open => !open)} />
    <section className="world-stage game-stage" aria-label={t('Cart showroom')}>
      <RoomZones>
        <RoomScene scenery="peach" shelf={shelf} counter={() => setListOpen(true)} baristaName={t('Clerk')} studioSet={studioSet} hour={14} />
      </RoomZones>
    </section>
  </main>;
}

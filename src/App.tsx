import { RoomScene } from './room/RoomScene';

const noop = () => {};

export default function App() {
  return <main className="agent-house-app">
    <section className="world-stage game-stage" aria-label="小屋購物車">
      <RoomScene snapshot={null} scenery="peach" inspect={noop} energy={noop} counter={noop} hour={14} />
    </section>
  </main>;
}

import { useEffect, useRef, useState } from 'react';
import type { BaristaAppearance, Character } from '../../shared/domain';
import type { StudioSet as SetPlacement } from '../../shared/studio';
import type { PerformanceScript } from '../../shared/performance-script';
import type { RoomFinishChoice } from '../../shared/room-finishes';
import { t } from '../i18n';
import type { FurnitureItem } from '../room/furniture';
import { framePresenter, usePresenterReady } from '../room/presenterShot';
import { RoomScene, type RoomControls } from '../room/RoomScene';
import { NoRoomZones } from './RoomZones';

/** The room as a recording sees it: its furniture, finish and barista, with the studio set standing in it. */
export interface StudioSet { furniture: FurnitureItem[]; finish: RoomFinishChoice; brightness?: number; barista: Character; appearance?: BaristaAppearance; /** The studio set up on that floor; `furniture` already leaves out what it covers. */ studio?: SetPlacement | null }

const noop = () => {};

/**
 * The editing desk's live camera: a small second room framed exactly like the A-roll stage, with the barista waiting at the spot.
 * A rehearsal plays in it on the room's clock, with the recording badge and captions in the frame's corner; otherwise it holds
 * the script at `at` seconds, where the desk's playhead stands.
 */
export function StudioCamera({ set, script, rehearsal, at = 0, onEnd }: { set: StudioSet; script: PerformanceScript; rehearsal: { script: PerformanceScript; startedAt: number } | null; at?: number; onEnd?: () => void }) {
  const controls = useRef<RoomControls>(null); const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false), [fallback, setFallback] = useState(false);
  const [onAir, setOnAir] = useState<{ take: object; line: string | null } | null>(null);
  const ended = useRef(onEnd);
  useEffect(() => { ended.current = onEnd; });
  const onStage = usePresenterReady(ready && !fallback, controls, box, script.spot);
  useEffect(() => {
    const room = controls.current, node = box.current; if (!onStage || !room || !node) return;
    const play = (seconds: number, shown: PerformanceScript) => { node.dataset.t = seconds.toFixed(3); return framePresenter(room, shown, seconds); };
    if (!rehearsal) { play(at, script); return; }
    let frame = 0;
    const tick = () => {
      const frameAt = play(Math.max(0, (Date.now() - rehearsal.startedAt) / 1000), rehearsal.script);
      if (frameAt.done) { play(0, script); setOnAir(null); ended.current?.(); return; }
      setOnAir(current => current?.take === rehearsal && current.line === frameAt.line ? current : { take: rehearsal, line: frameAt.line });
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [onStage, rehearsal, script, at]);

  const line = rehearsal && onAir?.take === rehearsal ? onAir.line : undefined;
  return <div className="studio-camera-view" ref={box} data-testid="studio-camera" data-ready={onStage} data-rehearsing={line !== undefined}>
    <NoRoomZones><div className="studio-camera-room" inert style={{ visibility: onStage ? 'visible' : 'hidden' }}>
      <RoomScene demo uiHidden cameraControls={false} scenery="peach" furniture={set.furniture} finish={set.finish} brightness={set.brightness}
        barista={set.barista} baristaAppearance={set.appearance} hour={14} frameHeight={script.format.height} studioSet={set.studio} counter={noop}
        onReady={() => setReady(true)} onFallback={() => setFallback(true)} controls={controls} />
    </div></NoRoomZones>
    {!onStage && <p className="studio-camera-wait" role="status">{t(fallback ? 'The camera needs 3D, which this device cannot show.' : 'The barista is getting into place…')}</p>}
    {line !== undefined && <div className="studio-on-air" role="status" data-testid="studio-camera-on-air">
      <span className="studio-on-air-badge"><i aria-hidden="true" />{t('Recording')}</span>
      {line && <p className="studio-caption">{line}</p>}
    </div>}
  </div>;
}

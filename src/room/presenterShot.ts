import { useEffect, useState, type RefObject } from 'react';
import { performanceAt, type PerformanceScript } from '../../shared/performance-script';
import { lerp, smooth } from '../video/ease';
import type { RoomControls } from './RoomScene';

/**
 * A presenter shot is a front camera on the host, eye level with a seated barista, like a talk show's main camera.
 * The A-roll stage and the editing desk's camera both frame through here, so the desk shows what the recording will.
 */
const BLEND_SECONDS = .5;

/** The shot at `t`: the script's zoom 1–3 and how far it has turned from the host (0) to the spot's desk (1). A cue's camera eases in from the one before it. */
function shotAt(script: PerformanceScript, t: number) {
  const cut = Math.max(0, ...script.cues.flatMap(cue => [cue.at, cue.until]).filter(at => at <= t));
  const before = performanceAt(script, Math.max(0, cut - 1e-3)).camera, now = performanceAt(script, t).camera;
  const k = cut === 0 ? 1 : smooth(t, cut, cut + BLEND_SECONDS), focus = (camera: typeof now) => camera.focus === 'spot' ? 1 : 0;
  return { zoom: lerp(before.zoom, now.zoom, k), toward: lerp(focus(before), focus(now), k) };
}

/** Sends the barista to the script's spot and reports when they have arrived there, so a shot never shows them walking in. */
export function usePresenterReady(ready: boolean, controls: RefObject<RoomControls | null>, box: RefObject<HTMLElement | null>, spot: string) {
  const [arrived, setArrived] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || arrived === spot) return;
    let frame = 0;
    controls.current?.present?.(spot); controls.current?.baristaAction?.('idle', 0);
    const look = () => {
      const canvas = box.current?.querySelector<HTMLElement>('.room-canvas');
      const presenter = JSON.parse(canvas?.dataset.presenter ?? 'null') as { spot?: string; onStage?: boolean } | null;
      if (presenter?.onStage && presenter.spot === spot) { setArrived(spot); return; }
      frame = requestAnimationFrame(look);
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [ready, arrived, spot, controls, box]);
  return arrived === spot;
}

/** Plays `t` of the script in the room and points the front camera at it. */
export function framePresenter(room: RoomControls, script: PerformanceScript, t: number) {
  const at = performanceAt(script, t);
  room.present?.(at.spot); room.baristaAction?.(at.act, at.elapsed);
  room.shoot?.(shotAt(script, t));
  return at;
}

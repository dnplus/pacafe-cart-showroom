import type { PointerEvent } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import type { PerformanceScript } from '../../shared/performance-script';
import { t } from '../i18n';

/** One storyboard beat: the host on camera (A) or a cutaway (B), with its caption and length. */
export interface Beat { id: string; roll: 'A' | 'B'; caption: string; seconds: number }

/** `mm:ss.s` for the desk's timecode. */
export const timecode = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

/**
 * The desk's timeline: captions from the script, the A and B beats of the storyboard and the narration lane, with a playhead.
 * It is not an editor: tapping a track moves the playhead, and changes go to the editor through the chat.
 */
export function StudioTimeline({ script, board, length, time, playing, seek, toggle, restart }: {
  script: PerformanceScript; board: readonly Beat[]; length: number; time: number; playing: boolean;
  seek: (seconds: number) => void; toggle: () => void; restart: () => void;
}) {
  const at = (seconds: number) => `${Math.min(100, seconds / length * 100)}%`;
  const ticks = Array.from({ length: Math.floor(length / step(length)) + 1 }, (_, index) => index * step(length));
  const beats = board.reduce<{ beat: Beat; from: number }[]>((all, beat) => [...all, { beat, from: (all.at(-1)?.from ?? 0) + (all.at(-1)?.beat.seconds ?? 0) }], []);
  const lane = (roll: 'A' | 'B') => beats.filter(({ beat }) => beat.roll === roll).map(({ beat, from }) =>
    <span key={beat.id} className="studio-clip" data-roll={roll} style={{ left: at(from), width: at(beat.seconds) }} title={beat.caption}>{beat.caption || roll}</span>);
  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    seek(Math.max(0, Math.min(length, (event.clientX - box.left) / box.width * length)));
  };
  return <section className="studio-timeline" aria-label={t('Timeline')} data-testid="studio-timeline">
    <div className="studio-transport">
      <button type="button" className="studio-transport-button" aria-label={t('Play from the start')} onClick={restart}><SkipBack size={15} /></button>
      <button type="button" className="studio-transport-button" data-testid="studio-play" aria-label={t(playing ? 'Pause' : 'Play')} onClick={toggle}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
      <span className="studio-timecode" data-testid="studio-timecode">{timecode(time)} / {timecode(length)}</span>
    </div>
    <div className="studio-tracks">
      <div className="studio-track-names" aria-hidden="true">
        <span />
        <span>{t('Captions')}</span>
        <span>{t('A · host')}</span>
        <span>{t('B · cutaways')}</span>
        <span>{t('Narration')}</span>
      </div>
      <div className="studio-lanes" onPointerDown={scrub} role="slider" tabIndex={0} aria-label={t('Playhead')} aria-valuemin={0} aria-valuemax={Math.round(length * 10) / 10} aria-valuenow={Math.round(time * 10) / 10} aria-valuetext={timecode(time)}
        onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); seek(Math.max(0, Math.min(length, time + (event.key === 'ArrowRight' ? .5 : -.5)))); } }}>
        <div className="studio-ruler">{ticks.map(tick => <span key={tick} style={{ left: at(tick) }}>{timecode(tick).slice(0, 5)}</span>)}</div>
        <div className="studio-lane">{script.cues.filter(cue => cue.line).map(cue => <span key={cue.at} className="studio-clip" data-roll="caption" style={{ left: at(cue.at), width: at(cue.until - cue.at) }}>{cue.line}</span>)}</div>
        <div className="studio-lane">{lane('A')}</div>
        <div className="studio-lane">{lane('B')}</div>
        <div className="studio-lane studio-lane-empty"><small>{t('Narration comes from your editor\'s computer.')}</small></div>
        <i className="studio-playhead" style={{ left: at(time) }} data-testid="studio-playhead" />
      </div>
    </div>
  </section>;
}
const step = (length: number) => length > 60 ? 10 : length > 20 ? 5 : length > 8 ? 2 : 1;

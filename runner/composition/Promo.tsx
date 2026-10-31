import type { CSSProperties } from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, useCurrentFrame } from 'remotion';
import { charCount, DISCLAIMER, PROMO_FORMAT, SUBTITLE, type PromoInput, type Scene, type Storyboard } from '../storyboard.ts';

const FONT = '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif';
const INK = '#4a3424', WOOD = '#b07a4f', CREAM = '#fbf4e8';
const TILE_COLORS = ['#e8a87c', '#c9a66b', '#d98e73', '#a3b18a', '#e0b973', '#b8977e', '#d4a5a5', '#9fb4a8'];

const fadeIn = (sec: number, delay = 0) => ({ opacity: interpolate(sec, [delay, delay + 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), transform: `translateY(${interpolate(sec, [delay, delay + 0.4], [18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)` });
const pill: CSSProperties = { display: 'inline-block', padding: '8px 22px', borderRadius: 999, background: WOOD, color: CREAM, fontWeight: 700 };

function Room({ children }: { children: React.ReactNode }) {
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: INK, background: 'linear-gradient(180deg, #f6e7d2 0%, #f1dcc0 74%, #c48b5c 74%, #a8714a 100%)' }}>
      <div style={{ position: 'absolute', left: 48, top: 36, ...pill, fontSize: 24, background: '#8a5a3b' }}>小屋購物車</div>
      {children}
    </AbsoluteFill>
  );
}

function Shelf({ count, sec }: { count: number; sec: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 64px)', gap: 14, padding: 18, background: '#8a5a3b', borderRadius: 14 }}>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} style={{ height: 64, borderRadius: 10, background: i < count ? TILE_COLORS[i % TILE_COLORS.length] : '#6f4930', ...i < count ? fadeIn(sec, 0.15 + i * 0.08) : {} }} />
      ))}
    </div>
  );
}

function SceneView({ scene, sec }: { scene: Scene; sec: number }) {
  switch (scene.kind) {
    case 'opening': return (
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 72, paddingBottom: 120 }}>
        <div style={fadeIn(sec)}>
          <div style={{ fontSize: 68, fontWeight: 800 }}>{scene.nickname}的小屋購物車</div>
          <div style={{ fontSize: 34, marginTop: 16 }}>架上 {scene.count} 件 Muse 採買時記下的東西</div>
          {scene.total && <div style={{ ...pill, fontSize: 32, marginTop: 24 }}>總額 {scene.total}</div>}
        </div>
        <Shelf count={Math.min(12, scene.count)} sec={sec} />
      </AbsoluteFill>
    );
    case 'item': {
      const n = Number(scene.id.replace('item-', ''));
      return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 120 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 40, width: 920, padding: 40, borderRadius: 28, background: CREAM, boxShadow: '0 18px 40px rgba(74, 52, 36, 0.25)', ...fadeIn(sec) }}>
            <div style={{ flex: 'none', width: 200, height: 200, borderRadius: 22, background: TILE_COLORS[(n - 1) % TILE_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 96, fontWeight: 800, color: CREAM }}>
              {[...scene.title.replace(/^[「【《(（[\s]+/, '')][0]}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, opacity: 0.7 }}>第 {n} 件</div>
              <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{scene.title}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 20, fontSize: 30 }}>
                <span style={{ ...pill, background: '#a3b18a' }}>× {scene.qty}</span>
                {scene.price && <span style={pill}>{scene.price}</span>}
              </div>
            </div>
          </div>
        </AbsoluteFill>
      );
    }
    case 'ending': return (
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', paddingBottom: 150 }}>
        <div style={fadeIn(sec)}>
          <div style={{ fontSize: 64, fontWeight: 800 }}>小屋購物車</div>
          <div style={{ fontSize: 32, marginTop: 14 }}>Muse 採買時記下的東西，都擺在這裡</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 24, lineHeight: 1.6, color: '#5b4636', ...fadeIn(sec, 0.3) }}>
          {DISCLAIMER.map(line => <div key={line}>{line}</div>)}
        </div>
      </AbsoluteFill>
    );
  }
}

/** Two lines at a time; each page stays up for its share of the scene's characters. */
function subtitlePage(scene: Scene, sec: number) {
  const pages = Array.from({ length: Math.ceil(scene.subtitle.length / SUBTITLE.linesPerPage) }, (_, i) => scene.subtitle.slice(i * SUBTITLE.linesPerPage, (i + 1) * SUBTITLE.linesPerPage));
  const total = charCount(scene.subtitle), share = sec / (scene.endSec - scene.startSec) * total;
  let seen = 0;
  return pages.find(page => (seen += charCount(page)) > share) ?? pages.at(-1)!;
}

/** Each line on its own, never wrapped, so a line wider than the safe width shows as one; the QA loop wraps it. */
function Subtitle({ lines }: { lines: readonly string[] }) {
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 44 }}>
      <div style={{ padding: '12px 32px', borderRadius: 16, background: 'rgba(43, 28, 19, 0.82)', color: '#fff', fontSize: SUBTITLE.fontSize, lineHeight: 1.35, textAlign: 'center', whiteSpace: 'pre' }}>
        {lines.map(line => <div key={line}>{line}</div>)}
      </div>
    </AbsoluteFill>
  );
}

/** One frame of the video at `atSec`, without Remotion's timing context, so tests can draw it directly. */
export function PromoFrame({ storyboard, atSec }: { storyboard: Storyboard; atSec: number }) {
  const scene = storyboard.scenes.find(s => atSec < s.endSec) ?? storyboard.scenes.at(-1)!, sec = atSec - scene.startSec;
  return (
    <Room>
      <SceneView scene={scene} sec={sec} />
      <Subtitle lines={subtitlePage(scene, sec)} />
    </Room>
  );
}

export function Promo({ storyboard, voice }: PromoInput) {
  const frame = useCurrentFrame();
  return (
    <>
      <PromoFrame storyboard={storyboard} atSec={frame / PROMO_FORMAT.fps} />
      {voice.map(clip => {
        const scene = storyboard.scenes.find(s => s.id === clip.sceneId)!;
        const from = Math.round(scene.startSec * PROMO_FORMAT.fps);
        return <Sequence key={clip.sceneId} from={from} durationInFrames={Math.round(scene.endSec * PROMO_FORMAT.fps) - from}><Audio src={clip.src} /></Sequence>;
      })}
    </>
  );
}

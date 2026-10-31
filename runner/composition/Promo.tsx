import { createContext, useContext, useState, type ComponentProps, type CSSProperties } from 'react';
import { AbsoluteFill, Audio, Img, interpolate, Sequence, useCurrentFrame } from 'remotion';
import { charCount, DISCLAIMER, PROMO_FORMAT, SUBTITLE, type PromoInput, type Scene, type Storyboard } from '../storyboard.ts';
import museArt from '../../public/art/characters/muse-fullbody.png';
import ownerArt from '../../public/art/characters/owner-fullbody.png';
import ownerSheet from '../../public/art/characters/owner-spritesheet.png';
import closeBack from './plates/close-back.png';
import closeFront from './plates/close-front.png';
import plateLayout from './plates/plates.json';
import wideBack from './plates/wide-back.png';
import wideFront from './plates/wide-front.png';

const FONT = '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif';
const INK = '#4a3424', WOOD = '#b07a4f', CREAM = '#fbf4e8';
const TILE_COLORS = ['#e8a87c', '#c9a66b', '#d98e73', '#a3b18a', '#e0b973', '#b8977e', '#d4a5a5', '#9fb4a8'];

/** Remotion's Img holds the frame until the picture has loaded; tests draw frames outside a composition and pass a plain img. */
export const Picture = createContext<React.ComponentType<ComponentProps<typeof Img>>>(Img);

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const fadeIn = (sec: number, delay = 0) => ({ opacity: interpolate(sec, [delay, delay + 0.4], [0, 1], clamp), transform: `translateY(${interpolate(sec, [delay, delay + 0.4], [18, 0], clamp)}px)` });
const pill: CSSProperties = { display: 'inline-block', padding: '8px 22px', borderRadius: 999, background: WOOD, color: CREAM, fontWeight: 700 };

/**
 * The studio set from the room (scripts/promo-plates.mjs): the room behind, the desk in front, and where a figure standing at
 * the chair has its feet. A figure is RESIDENT_HEIGHT (2.1 m) tall in the room, measured over the drawn body.
 */
const PLATES = { wide: { back: wideBack, front: wideFront, ...plateLayout.wide }, close: { back: closeBack, front: closeFront, ...plateLayout.close } };
type Shot = keyof typeof PLATES;
const FIGURE_METRES = 2.1;
/** The drawn body inside each picture, from its alpha: [top, bottom] of 1024 for the full-body art, of a 256 cell for the sheet. */
const ART = { owner: { src: ownerArt, width: 512, height: 1024, body: [55, 972] }, muse: { src: museArt, width: 512, height: 1024, body: [160, 864] } } as const;
const SHEET = { cell: 256, body: [12, 256], westRow: 1, frames: 8, fps: 10 } as const;

/** A beat of the host: a hop when something lands, a bob while talking. */
function hop(sec: number, at: number) { const t = (sec - at) / 0.42; return t < 0 || t > 1 ? 0 : Math.sin(t * Math.PI) * 26; }
const talk = (sec: number) => Math.abs(Math.sin(sec * 7.4)) * 5;

/** A figure standing at the chair, `dx` metres to the side, between the room and the desk. */
function Figure({ shot, who, dx = 0, lift = 0, lean = 0, opacity = 1 }: { shot: Shot; who: keyof typeof ART; dx?: number; lift?: number; lean?: number; opacity?: number }) {
  const Img = useContext(Picture), plate = PLATES[shot], art = ART[who], scale = FIGURE_METRES * plate.pxPerMetre / (art.body[1] - art.body[0]);
  const width = art.width * scale, height = art.height * scale, bottom = plate.feet.y + (art.height - art.body[1]) * scale;
  return (
    <Img src={art.src} style={{ position: 'absolute', width, height, left: plate.feet.x + dx * plate.pxPerMetre - width / 2, top: bottom - height - lift, opacity, transform: `rotate(${lean}deg)`, transformOrigin: '50% 90%' }} />
  );
}

/** The owner walking in from the right on the sprite sheet's west row, `x` metres from the chair. */
function Walker({ shot, x, sec }: { shot: Shot; x: number; sec: number }) {
  const Img = useContext(Picture), plate = PLATES[shot], scale = FIGURE_METRES * plate.pxPerMetre / (SHEET.body[1] - SHEET.body[0]), size = SHEET.cell * scale;
  const frame = Math.floor(sec * SHEET.fps) % SHEET.frames;
  return (
    <div style={{ position: 'absolute', width: size, height: size, left: plate.feet.x + x * plate.pxPerMetre - size / 2, top: plate.feet.y - size, overflow: 'hidden' }}>
      <Img src={ownerSheet} style={{ position: 'absolute', width: size * 8, height: size * 4, left: -frame * size, top: -SHEET.westRow * size }} />
    </div>
  );
}

/** A mark over a figure's head, like the room's: a disc with a symbol that pops in and fades. */
function Mark({ shot, text, sec, at, dx = 0 }: { shot: Shot; text: string; sec: number; at: number; dx?: number }) {
  const plate = PLATES[shot], t = sec - at;
  if (t < 0 || t > 1.6) return null;
  const size = plate.pxPerMetre * 0.42, pop = interpolate(t, [0, 0.18, 0.3], [0.2, 1.15, 1], clamp), fade = interpolate(t, [1.2, 1.6], [1, 0], clamp);
  const colour = text === '♥' ? '#e0607a' : text === '!' ? '#d9822b' : '#5f8f6e';
  return (
    <div style={{ position: 'absolute', left: plate.feet.x + (dx + 0.42) * plate.pxPerMetre - size / 2, top: plate.feet.y - (FIGURE_METRES + 0.15) * plate.pxPerMetre - size / 2, width: size, height: size, borderRadius: '50%', background: '#fffaf0', border: `${size * 0.05}px solid #a87451`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.56, fontWeight: 800, color: colour, transform: `scale(${pop})`, opacity: fade }}>{text}</div>
  );
}

/** The set, with whatever stands at the chair between the room and the desk; `push` slowly closes the camera in. */
function Stage({ shot, push, children }: { shot: Shot; push: number; children: React.ReactNode }) {
  const Img = useContext(Picture), plate = PLATES[shot];
  return (
    <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: `${plate.feet.x}px ${Math.min(plate.feet.y, 720) * 0.6}px` }}>
      <Img src={plate.back} style={{ position: 'absolute', width: 1280, height: 720 }} />
      {children}
      <Img src={plate.front} style={{ position: 'absolute', width: 1280, height: 720 }} />
    </AbsoluteFill>
  );
}

function ProductPicture({ scene, n }: { scene: Extract<Scene, { kind: 'item' }>; n: number }) {
  const Img = useContext(Picture), [broken, setBroken] = useState(false);
  const box: CSSProperties = { width: 420, height: 280, borderRadius: 20, overflow: 'hidden', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (scene.image && !broken) return <div style={box}><Img src={scene.image} maxRetries={1} onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div>;
  return (
    <div style={{ ...box, background: TILE_COLORS[(n - 1) % TILE_COLORS.length], fontSize: 120, fontWeight: 800, color: CREAM }}>
      {[...scene.title.replace(/^[「【《(（[\s]+/, '')][0]}
    </div>
  );
}

function ItemCard({ scene, n, sec }: { scene: Extract<Scene, { kind: 'item' }>; n: number; sec: number }) {
  const slide = interpolate(sec, [0.15, 0.6], [80, 0], clamp), shown = interpolate(sec, [0.15, 0.5], [0, 1], clamp);
  return (
    <div style={{ position: 'absolute', right: 56, top: 64, width: 420, padding: 20, borderRadius: 28, background: CREAM, boxShadow: '0 18px 40px rgba(74, 52, 36, 0.3)', opacity: shown, transform: `translateX(${slide}px) rotate(${interpolate(sec, [0.15, 0.6], [4, 1.2], clamp)}deg)` }}>
      <ProductPicture scene={scene} n={n} />
      <div style={{ fontSize: 20, opacity: 0.7, marginTop: 14 }}>第 {n} 件</div>
      <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{scene.title}</div>
      <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 26 }}>
        <span style={{ ...pill, background: '#a3b18a' }}>× {scene.qty}</span>
        {scene.price && <span style={pill}>{scene.price}</span>}
      </div>
    </div>
  );
}

function SceneView({ scene, sec, n }: { scene: Scene; sec: number; n: number }) {
  const length = scene.endSec - scene.startSec;
  switch (scene.kind) {
    case 'opening': {
      // The owner walks in behind the desk, turns to the camera and hops hello.
      const walk = 1.1, x = interpolate(sec, [0, walk], [1.9, 0], clamp);
      return (
        <>
          <Stage shot="wide" push={interpolate(sec, [0, length], [1, 1.06])}>
            {sec < walk ? <Walker shot="wide" x={x} sec={sec} /> : <Figure shot="wide" who="owner" lift={hop(sec, walk + 0.1) + talk(sec)} />}
            <Mark shot="wide" text="♪" sec={sec} at={walk + 0.1} />
          </Stage>
          <div style={{ position: 'absolute', left: 56, top: 96, padding: '24px 32px', borderRadius: 24, background: 'rgba(251, 244, 232, 0.94)', boxShadow: '0 14px 30px rgba(74, 52, 36, 0.22)', ...fadeIn(sec, 0.3) }}>
            <div style={{ fontSize: 46, fontWeight: 800 }}>{scene.nickname}的小屋購物車</div>
            <div style={{ fontSize: 24, marginTop: 10 }}>架上 {scene.count} 件，Muse 採買時記下的東西</div>
            {scene.total && <div style={{ ...pill, fontSize: 24, marginTop: 16 }}>總額 {scene.total}</div>}
          </div>
        </>
      );
    }
    case 'item': {
      // Closer on the host, who stands left of centre so the card has the right side; a hop and a mark as it lands.
      return (
        <>
          <Stage shot="close" push={interpolate(sec, [0, length], [1, 1.04])}>
            <Figure shot="close" who="owner" lift={hop(sec, 0.3) + talk(sec)} lean={interpolate(sec, [0.3, 0.7], [0, 4], clamp)} />
            <Mark shot="close" text={n % 2 ? '!' : '♪'} sec={sec} at={0.3} />
          </Stage>
          <ItemCard scene={scene} n={n} sec={sec} />
        </>
      );
    }
    case 'ending': {
      // Muse steps in beside the owner; both wave off with a heart over the disclaimer.
      const muse = interpolate(sec, [0.2, 0.8], [0, 1], clamp);
      return (
        <>
          <Stage shot="wide" push={interpolate(sec, [0, length], [1.06, 1])}>
            <Figure shot="wide" who="owner" dx={-0.45} lift={hop(sec, 0.9) + talk(sec)} lean={-2} />
            <Figure shot="wide" who="muse" dx={0.75} lift={hop(sec, 1.05)} opacity={muse} lean={2} />
            <Mark shot="wide" text="♥" sec={sec} at={0.9} dx={-0.45} />
            <Mark shot="wide" text="♥" sec={sec} at={1.05} dx={0.75} />
          </Stage>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 22, textAlign: 'center', ...fadeIn(sec, 0.2) }}>
            <div style={{ display: 'inline-block', padding: '14px 34px', borderRadius: 22, background: 'rgba(251, 244, 232, 0.94)' }}>
              <div style={{ fontSize: 40, fontWeight: 800 }}>小屋購物車</div>
              <div style={{ fontSize: 20, marginTop: 6, lineHeight: 1.5, color: '#5b4636' }}>
                {DISCLAIMER.map(line => <div key={line}>{line}</div>)}
              </div>
            </div>
          </div>
        </>
      );
    }
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
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 36 }}>
      <div style={{ padding: '12px 32px', borderRadius: 16, background: 'rgba(43, 28, 19, 0.82)', color: '#fff', fontSize: SUBTITLE.fontSize, lineHeight: 1.35, textAlign: 'center', whiteSpace: 'pre' }}>
        {lines.map(line => <div key={line}>{line}</div>)}
      </div>
    </AbsoluteFill>
  );
}

/** One frame of the video at `atSec`, without Remotion's timing context, so tests can draw it directly. */
export function PromoFrame({ storyboard, atSec }: { storyboard: Storyboard; atSec: number }) {
  const found = storyboard.scenes.findIndex(s => atSec < s.endSec), index = found < 0 ? storyboard.scenes.length - 1 : found;
  const scene = storyboard.scenes[index], sec = atSec - scene.startSec;
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: INK, background: '#d8c3a8', overflow: 'hidden' }}>
      <SceneView key={scene.id} scene={scene} sec={sec} n={index} />
      {scene.kind !== 'ending' && <div style={{ position: 'absolute', left: 48, top: 30, ...pill, fontSize: 22, background: '#8a5a3b' }}>小屋購物車</div>}
      <Subtitle lines={subtitlePage(scene, sec)} />
    </AbsoluteFill>
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

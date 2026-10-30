import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../browserStorage';

/** What the viewer picked in Settings; `auto` lets the device decide. */
export type GraphicsQuality = 'auto' | 'high' | 'medium' | 'low';
type GraphicsTier = Exclude<GraphicsQuality, 'auto'>;
export const graphicsQualities: readonly GraphicsQuality[] = ['auto', 'high', 'medium', 'low'];
const tiers: readonly GraphicsTier[] = ['high', 'medium', 'low'];

export interface GraphicsProfile {
  tier: GraphicsTier;
  maxPixelRatio: number;
  /** `soft` is the original filtered sun shadow; `simple` is a smaller unfiltered map. */
  shadows: 'soft' | 'simple' | 'off';
  /** Fixed when the WebGL context is made, so changing it rebuilds the room. */
  antialias: boolean;
  fps: number;
  /** Fewer decorative moves: no glow pulse, no furniture wobble, short celebrations. */
  calmDecor: boolean;
}
const profiles: Record<GraphicsTier, GraphicsProfile> = {
  high: { tier: 'high', maxPixelRatio: 1.5, shadows: 'soft', antialias: true, fps: 30, calmDecor: false },
  medium: { tier: 'medium', maxPixelRatio: 1.5, shadows: 'simple', antialias: true, fps: 30, calmDecor: false },
  low: { tier: 'low', maxPixelRatio: 1, shadows: 'off', antialias: false, fps: 30, calmDecor: true },
};
export const graphicsProfile = (tier: GraphicsTier) => profiles[tier];

export interface DeviceHints { renderer: string | null; reducedMotion: boolean; cores: number | undefined; touch: boolean }
const softwareRenderer = /swiftshader|llvmpipe|software/i;
/**
 * Software WebGL (no GPU), reduced motion or two cores or fewer get low. Under six cores or a touch-first screen,
 * where battery matters more than the soft shadow, get medium; everything else keeps the original look.
 */
export function autoGraphicsTier({ renderer, reducedMotion, cores, touch }: DeviceHints): GraphicsTier {
  if ((renderer && softwareRenderer.test(renderer)) || reducedMotion || (cores !== undefined && cores <= 2)) return 'low';
  if (touch || (cores !== undefined && cores < 6)) return 'medium';
  return 'high';
}

const tierOf = (value: string | null): GraphicsTier | null => tiers.includes(value as GraphicsTier) ? value as GraphicsTier : null;
/** `?fx=low|medium|high` pins the tier for QA without touching the saved choice. */
export const forcedGraphicsTier = (search: string) => tierOf(new URLSearchParams(search).get('fx'));

const storageKey = 'pa-cafe-graphics-quality';
export function readGraphicsQuality(): GraphicsQuality {
  const stored = readStored(storageKey);
  return graphicsQualities.includes(stored as GraphicsQuality) ? stored as GraphicsQuality : 'auto';
}
const listeners = new Set<() => void>();
let current: GraphicsQuality | null = null;
export function saveGraphicsQuality(next: GraphicsQuality) {
  writeStored(storageKey, next === 'auto' ? null : next);
  current = next; listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getQuality = () => current ??= readGraphicsQuality();

let probed: string | null | undefined;
/** The WebGL renderer string from a throwaway context, read once per page. */
function probeRenderer() {
  if (probed !== undefined) return probed;
  probed = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      probed = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '') || null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { probed = null; }
  return probed;
}
const matches = (query: string) => typeof matchMedia === 'function' && matchMedia(query).matches;
function deviceTier(): GraphicsTier {
  return autoGraphicsTier({ renderer: probeRenderer(), reducedMotion: matches('(prefers-reduced-motion: reduce)'), cores: navigator.hardwareConcurrency || undefined, touch: matches('(pointer: coarse)') });
}

/** The tier the room draws at: the URL override, then the saved choice, then the device. */
export function resolveGraphicsTier(quality: GraphicsQuality, search: string, device: () => GraphicsTier): GraphicsTier {
  return forcedGraphicsTier(search) ?? (quality === 'auto' ? device() : quality);
}
let deviceCache: GraphicsTier | undefined;
const cachedDevice = () => deviceCache ??= deviceTier();
export function useGraphicsQuality() {
  const quality = useSyncExternalStore(subscribe, getQuality, () => 'auto' as const);
  const tier = resolveGraphicsTier(quality, typeof location === 'undefined' ? '' : location.search, cachedDevice);
  return { quality, tier, autoTier: quality === 'auto' ? cachedDevice() : null, forced: typeof location !== 'undefined' && forcedGraphicsTier(location.search) !== null };
}

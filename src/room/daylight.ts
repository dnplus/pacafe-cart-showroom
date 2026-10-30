export interface Daylight {
  phase: 'morning' | 'day' | 'evening' | 'night';
  sun: string; sunIntensity: number; sunAt: [number, number, number];
  sky: string; ground: string; hemi: number; fill: string; fillIntensity: number; environment: number;
  window: string; moon: string; cloud: string; patch: string; patchOpacity: number;
  lamp: number; tint: string; boards: string; stage: string; exposure: number;
}

const presets: Record<Daylight['phase'], Daylight> = {
  morning: { phase: 'morning', sun: '#ffc79c', sunIntensity: 2.5, sunAt: [-9, 9, -8], sky: '#ffe4cf', ground: '#8a7366', hemi: 1, fill: '#dfe6fb', fillIntensity: .6, environment: .26, window: '#f6d6c4', moon: '#ffe7a8', cloud: '#fff4ec', patch: '#ffc796', patchOpacity: .4, lamp: .3, tint: '#fff2e8', boards: '#ffffff', stage: '#ecd7bb', exposure: 1 },
  day: { phase: 'day', sun: '#ffd9a8', sunIntensity: 2.9, sunAt: [-5, 13, -9], sky: '#ffeccc', ground: '#8a7560', hemi: 1.05, fill: '#e4e9f7', fillIntensity: .55, environment: .28, window: '#c8e5f1', moon: '#ffe49a', cloud: '#fff7e2', patch: '#ffd59a', patchOpacity: .34, lamp: .45, tint: '#ffffff', boards: '#ffffff', stage: '#ead6b8', exposure: 1 },
  evening: { phase: 'evening', sun: '#ffa867', sunIntensity: 2.3, sunAt: [4, 6.5, -11], sky: '#ffd2a8', ground: '#7a5e4c', hemi: .9, fill: '#c9d3f2', fillIntensity: .45, environment: .22, window: '#f1b07f', moon: '#ffd27a', cloud: '#ffd9c0', patch: '#ffad6b', patchOpacity: .4, lamp: .85, tint: '#ffe8d2', boards: '#f6ece2', stage: '#e8ccab', exposure: .98 },
  night: { phase: 'night', sun: '#a9bbea', sunIntensity: .6, sunAt: [-4, 12, -8], sky: '#66729a', ground: '#3a3440', hemi: .72, fill: '#8a9cd0', fillIntensity: .42, environment: .12, window: '#2a3961', moon: '#f4f1d8', cloud: '#6c7698', patch: '#bccbff', patchOpacity: .16, lamp: 1, tint: '#dadff0', boards: '#d9dbe6', stage: '#d9cab4', exposure: .96 },
};
const keys: [number, Daylight['phase']][] = [[0, 'night'], [5, 'night'], [7, 'morning'], [9.5, 'day'], [16, 'day'], [18, 'evening'], [19.5, 'night'], [24, 'night']];

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
function mix(a: string, b: string, t: number) {
  return `#${[0, 1, 2].map(i => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function daylight(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  const next = keys.findIndex(([at]) => at > h); const [fromAt, fromPhase] = keys[next - 1]; const [toAt, toPhase] = keys[next];
  const t = (h - fromAt) / (toAt - fromAt); const a = presets[fromPhase], b = presets[toPhase];
  const out = { ...a } as Record<string, unknown>;
  for (const key of Object.keys(a) as (keyof Daylight)[]) {
    const x = a[key], y = b[key];
    if (typeof x === 'number' && typeof y === 'number') out[key] = lerp(x, y, t);
    else if (typeof x === 'string' && typeof y === 'string' && x.startsWith('#')) out[key] = mix(x, y, t);
    else if (Array.isArray(x) && Array.isArray(y)) out[key] = x.map((v, i) => lerp(v, y[i], t));
  }
  out.phase = t < .5 ? fromPhase : toPhase;
  return out as unknown as Daylight;
}

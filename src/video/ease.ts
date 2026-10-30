export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const smooth = (t: number, a: number, b: number) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
export const window_ = (t: number, a: number, b: number, rise = .35) => Math.min(smooth(t, a, a + rise), 1 - smooth(t, b - rise, b));
export const progress = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const back = (k: number) => { const c = 1.7; const x = clamp(k) - 1; return 1 + (c + 1) * x ** 3 + c * x ** 2; };

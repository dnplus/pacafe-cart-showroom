type Accent = 'peach' | 'sage' | 'lilac';

export interface SceneryTheme { wall: string; floor: string; board: string; light: string }
export interface Scenery { id: string; name: string; accent: Accent; price: number; theme: SceneryTheme }

export const sceneryCatalog = {
  peach: { id: 'peach', name: 'Peach afternoon', accent: 'peach', price: 0, theme: { wall: '#f3d6b8', floor: '#dfb981', board: '#36594a', light: '#fff1e0' } },
  sage: { id: 'sage', name: 'Sage garden', accent: 'sage', price: 0, theme: { wall: '#dce3c9', floor: '#dcbd8e', board: '#2f4f45', light: '#f4fbef' } },
  lilac: { id: 'lilac', name: 'Lilac dusk', accent: 'lilac', price: 0, theme: { wall: '#e1d6e8', floor: '#d9b68d', board: '#3d3f5c', light: '#f8f0ff' } },
} as const satisfies Record<string, Scenery>;
export type SceneryId = keyof typeof sceneryCatalog;
export const sceneryIds = Object.keys(sceneryCatalog) as [SceneryId, ...SceneryId[]];
export const defaultScenery: SceneryId = 'peach';
export const isSceneryId = (value: unknown): value is SceneryId => typeof value === 'string' && Object.hasOwn(sceneryCatalog, value);
export const ownedSceneries = (bought: readonly string[] = []): SceneryId[] => sceneryIds.filter(id => sceneryCatalog[id].price === 0 || bought.includes(id));
export const sceneryOf = (house: { scenery?: string; accent?: string }): SceneryId => isSceneryId(house.scenery) ? house.scenery : isSceneryId(house.accent) ? house.accent : defaultScenery;

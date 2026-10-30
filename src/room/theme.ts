import { sceneryCatalog, sceneryOf, type SceneryId, type SceneryTheme } from '../../shared/scenery';

export type Theme = SceneryTheme;
export const themeFor = (scenery: SceneryId): Theme => (sceneryCatalog[scenery] ?? sceneryCatalog[sceneryOf({})]).theme;

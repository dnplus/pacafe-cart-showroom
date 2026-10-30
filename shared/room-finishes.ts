export type RoomFinishSurface = 'wall' | 'floor';
type RoomFinishPattern = 'limewash' | 'stripe' | 'brick' | 'wainscot' | 'tile' | 'stars' | 'plank' | 'herringbone' | 'checker' | 'terrazzo' | 'marble';
interface RoomFinish { surface: RoomFinishSurface; title: string; pattern: RoomFinishPattern; base: string; accent: string; tier: 'normal' | 'special' }

/** Wallpapers and floors the room can wear; a missing surface keeps the scenery colour. */
export const roomFinishCatalog = {
  'wall-oat-limewash': { surface: 'wall', title: 'Oat limewash', pattern: 'limewash', base: '#efe2cc', accent: '#dcc8a8', tier: 'normal' },
  'wall-sage-stripe': { surface: 'wall', title: 'Sage stripe wallpaper', pattern: 'stripe', base: '#e3ead6', accent: '#c3d2b0', tier: 'normal' },
  'wall-red-brick': { surface: 'wall', title: 'Red brick', pattern: 'brick', base: '#b8664b', accent: '#ecd9c6', tier: 'normal' },
  'wall-walnut-wainscot': { surface: 'wall', title: 'Walnut wainscot', pattern: 'wainscot', base: '#f3e6d2', accent: '#8a5a3c', tier: 'normal' },
  'wall-sky-tile': { surface: 'wall', title: 'Sky subway tile', pattern: 'tile', base: '#dbe8ef', accent: '#b5c9d6', tier: 'normal' },
  'wall-starry-night': { surface: 'wall', title: 'Starry night', pattern: 'stars', base: '#2e3a5e', accent: '#f6d98e', tier: 'special' },
  'floor-walnut-plank': { surface: 'floor', title: 'Walnut planks', pattern: 'plank', base: '#8b5b3d', accent: '#6c4329', tier: 'normal' },
  'floor-oak-herringbone': { surface: 'floor', title: 'Oak herringbone', pattern: 'herringbone', base: '#d6a86f', accent: '#b98a52', tier: 'normal' },
  'floor-cafe-checker': { surface: 'floor', title: 'Cafe checkerboard', pattern: 'checker', base: '#f2ece1', accent: '#3d3a3a', tier: 'normal' },
  'floor-terracotta-tile': { surface: 'floor', title: 'Terracotta tile', pattern: 'tile', base: '#c57b57', accent: '#ead5c0', tier: 'normal' },
  'floor-speckled-terrazzo': { surface: 'floor', title: 'Speckled terrazzo', pattern: 'terrazzo', base: '#ece6db', accent: '#9aa59b', tier: 'normal' },
  'floor-gilded-marble': { surface: 'floor', title: 'Gilded marble', pattern: 'marble', base: '#f5f2ed', accent: '#c9a45c', tier: 'special' },
} as const satisfies Record<string, RoomFinish>;
export type RoomFinishId = keyof typeof roomFinishCatalog;
type FinishOn<S extends RoomFinishSurface> = { [K in RoomFinishId]: typeof roomFinishCatalog[K]['surface'] extends S ? K : never }[RoomFinishId];
export type RoomFinishChoice = { wall?: FinishOn<'wall'>; floor?: FinishOn<'floor'> };

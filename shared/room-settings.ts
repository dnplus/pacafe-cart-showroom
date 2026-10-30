import { countertopProducts } from './countertop-products.ts';
import { roomsSchema } from './rooms.ts';
import { floorIdSchema, type FloorId, floorOf } from './floors.ts';
import { roomBrightnessSchema } from './room-lighting-settings.ts';
import { roomFinishesSchema } from './room-finishes.ts';
import { canPlaceOnSurface } from './surface-placement.ts';
import { originalProductForItem, originalProductIds, type OriginalProductId } from './original-furniture-products.ts';
import { z } from 'zod';
import { characters } from './domain.ts';
import { collectionFurniture, collectionFor, standaloneCollectionKinds, fixtureVariants, type StandaloneCollectionKind } from './furniture-collections.ts';
import { collectionSupports, supportFit } from './collection-supports.ts';
import { MAX_ROOM_FURNITURE } from './furniture-series.ts';
import { furnitureSeries } from './furniture-series.ts';

const collectionCatalog = Object.fromEntries(standaloneCollectionKinds.map(kind => [kind, { variants: ['original'] as const, mount: collectionFurniture[kind].mount }])) as Record<StandaloneCollectionKind, { variants: readonly ['original']; mount: 'floor' | 'wall' | 'surface' }>;
export const roomFurnitureCatalog = {
  ...collectionCatalog,
  table: { variants: [...['plain', 'pine'], ...fixtureVariants('table')], mount: 'floor' },
  chair: { variants: [...['cardboard', 'plain', 'velvet'], ...fixtureVariants('chair')], mount: 'floor' },
  stool: { variants: [...['round'], ...fixtureVariants('stool')], mount: 'floor' },
  plant: { variants: ['leafy', 'cactus'], mount: 'floor' },
  signboard: { variants: ['open', 'menu'], mount: 'floor' },
  crate: { variants: ['stack', 'single'], mount: 'floor' },
  rug: { variants: ['star', 'round'], mount: 'floor' },
  bar: { variants: [...['walnut', 'oak', 'halloween'], ...fixtureVariants('bar')], mount: 'floor' },
  workBoard: { variants: ['slate', 'cork'], mount: 'wall' },
  menuBoard: { variants: ['chalk', 'cream'], mount: 'wall' },
  cafeSign: { variants: ['plate'], mount: 'wall' },
  beanShelf: { variants: ['jars', 'halloween'], mount: 'wall' },
  lamp: { variants: ['brass', 'festival'], mount: 'wall' },
  noticeBoard: { variants: ['cork'], mount: 'wall' },
  door: { variants: ['oak'], mount: 'wall' },
  deskLamp: { variants: ['brass'], mount: 'surface' },
  countertop: { variants: countertopProducts.map(product => product.variant), mount: 'surface' },
  potPlant: { variants: ['succulent'], mount: 'surface' },
  espressoMachine: { variants: [...['steel'], ...fixtureVariants('espressoMachine')], mount: 'surface' },
  grinder: { variants: [...['black'], ...fixtureVariants('grinder')], mount: 'surface' },
} as const;
export type RoomFurnitureKind = keyof typeof roomFurnitureCatalog;
export const stowableKinds: ReadonlySet<RoomFurnitureKind> = new Set([...standaloneCollectionKinds, 'table', 'chair', 'stool', 'plant', 'signboard', 'crate', 'rug', 'lamp', 'deskLamp', 'potPlant', 'countertop']);
export const surfaceHostKinds: ReadonlySet<RoomFurnitureKind> = new Set(['table', 'bar', ...standaloneCollectionKinds.filter(kind => collectionFurniture[kind].supports.length > 0)]);
export type RoomWall = 'back' | 'left';
export type RoomTurn = 0 | 1 | 2 | 3;
export interface RoomFurnitureItem {
  roomId?: string; floorId?: FloorId; id: string; kind: RoomFurnitureKind; variant: string; x: number; z: number; turn: RoomTurn;
  productId?: OriginalProductId; surfacePosition?: { x: number; z: number };
  size?: number; wall?: RoomWall; stowed?: boolean;
  on?: string; slot?: number;
}

export const roomFurnitureItemSchema = z.strictObject({
  roomId: z.string().min(1).max(150).optional(), floorId: floorIdSchema.optional(), id: z.string().min(1), kind: z.enum(Object.keys(roomFurnitureCatalog) as [RoomFurnitureKind, ...RoomFurnitureKind[]]),
  variant: z.string(), x: z.number().finite(), z: z.number().finite(), turn: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  size: z.number().finite().positive().optional(), wall: z.enum(['back', 'left']).optional(), stowed: z.boolean().optional(),
  productId: z.enum(originalProductIds as [OriginalProductId, ...OriginalProductId[]]).optional(),
  surfacePosition: z.strictObject({ x: z.number().finite().min(-8).max(8), z: z.number().finite().min(-8).max(8) }).optional(),
  on: z.string().min(1).optional(), slot: z.number().int().min(0).max(7).optional(),
}).superRefine((item, ctx) => {
  const spec = roomFurnitureCatalog[item.kind];
  if (item.productId && !originalProductForItem(item)) ctx.addIssue({ code: 'custom', path: ['productId'], message: 'Product does not match this furniture.' });
  if (item.surfacePosition && (spec.mount !== 'surface' || item.kind === 'espressoMachine' || item.kind === 'grinder')) ctx.addIssue({ code: 'custom', path: ['surfacePosition'], message: 'Only small surface furniture has a surface position.' });
  if (collectionFor(item.kind) && item.size !== undefined) ctx.addIssue({ code: 'custom', path: ['size'], message: 'Collected furniture keeps its admitted dimensions.' });
  if (!(spec.variants as readonly string[]).includes(item.variant)) ctx.addIssue({ code: 'custom', path: ['variant'], message: 'Unknown furniture variant.' });
  if (spec.mount !== 'wall' && item.wall !== undefined) ctx.addIssue({ code: 'custom', path: ['wall'], message: 'Only wall furniture has a wall mount.' });
  if (spec.mount !== 'surface' && (item.on !== undefined || item.slot !== undefined)) ctx.addIssue({ code: 'custom', path: ['on'], message: 'Only surface furniture stands on a table or bar.' });
  if (spec.mount === 'surface' && !item.stowed && (item.on === undefined || item.slot === undefined)) ctx.addIssue({ code: 'custom', path: ['on'], message: 'Surface furniture needs a table or bar slot.' });
  if (spec.mount === 'wall' && ((item.wall ?? 'back') === 'back' ? Math.abs(item.z) > .01 : Math.abs(item.x) > .01)) ctx.addIssue({ code: 'custom', message: 'Wall furniture must stay on its wall face.' });
  if (item.stowed && !stowableKinds.has(item.kind)) ctx.addIssue({ code: 'custom', path: ['stowed'], message: 'Cafe fixtures cannot be stowed.' });
});

function refineRoomFurniture(items: RoomFurnitureItem[], ctx: z.RefinementCtx, complete: boolean) {
  if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Furniture IDs must be unique.' });
  if (complete && (items.filter(item => item.kind === 'table').length !== 3 || items.filter(item => item.kind === 'bar').length !== 1 || !items.some(item => item.kind === 'workBoard'))) {
    ctx.addIssue({ code: 'custom', message: 'A cafe needs three tables, a bar and a work board.' });
  }
  const placed = items.filter(item => roomFurnitureCatalog[item.kind].mount === 'surface' && !item.stowed);
  for (const item of placed) {
    const host = items.find(other => other.id === item.on);
    if (!host || (host.roomId !== undefined && item.roomId !== undefined && host.roomId !== item.roomId) || floorOf(host) !== floorOf(item) || host.stowed || !surfaceHostKinds.has(host.kind)) { ctx.addIssue({ code: 'custom', message: 'Surface furniture must stand on a table or bar in the cafe.' }); continue; }
    const product = collectionFor(item.kind) ?? collectionFor(item.variant);
    const supports = collectionSupports(host);
    if (item.surfacePosition || items.some(other => !other.stowed && other.on === item.on && other.surfacePosition)) {
      if (!canPlaceOnSurface(item, host, items)) ctx.addIssue({ code: 'custom', message: 'This furniture overlaps or is outside its usable surface.' });
    } else if (product || supports || item.kind === 'countertop') {
      const slot = supports?.find(support => support.slot === item.slot) ?? (!supports && (host.kind === 'table' && item.slot === 0 || host.kind === 'bar' && item.slot! <= 3) ? { width: item.slot! >= 2 ? 1.1 : .65, depth: item.slot! >= 2 ? .78 : .65, takes: item.slot! >= 2 ? 'appliance' as const : 'small' as const, rotationY: 0 } : undefined);
      if (!slot || !supportFit(item.kind, item.variant, item.turn, slot)) ctx.addIssue({ code: 'custom', message: 'This furniture does not fit that support slot.' });
    }
  }
  if (new Set(placed.filter(item => !item.surfacePosition).map(item => `${item.on}:${item.slot}`)).size !== placed.filter(item => !item.surfacePosition).length) ctx.addIssue({ code: 'custom', message: 'Two pieces cannot share a slot.' });
}
export const roomFurnitureSchema = z.array(roomFurnitureItemSchema).max(MAX_ROOM_FURNITURE).superRefine((items,ctx)=>refineRoomFurniture(items,ctx,true));
export const roomFurnitureProjectionSchema = z.array(roomFurnitureItemSchema).max(MAX_ROOM_FURNITURE).superRefine((items,ctx)=>refineRoomFurniture(items,ctx,false));
export const roomSettingsSchema = z.strictObject({ rooms: roomsSchema.optional(), items: roomFurnitureSchema, brightness: roomBrightnessSchema.optional(), finishes: roomFinishesSchema.optional(), barista: z.enum(characters), furnitureSeries: z.enum(furnitureSeries).optional(), furnitureIdentityVersion: z.literal(1).optional() });
export const roomSettingsProjectionSchema = roomSettingsSchema.extend({items:roomFurnitureProjectionSchema});
export type PersistedRoomSettings = z.infer<typeof roomSettingsSchema>;

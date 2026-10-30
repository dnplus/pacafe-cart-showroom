import * as THREE from 'three';
import type { RoomFinishChoice, RoomFinishId } from '../../shared/room-finishes';
import { roomFloor, roomSize, roomWalls } from '../../shared/room-dimensions';
import { finishTile, paintFinish } from './finishes';
import type { Theme } from './theme';

/** A repeating texture sized for a face `width` × `height` world units across. */
function finishTexture(id: RoomFinishId, width: number, height: number): THREE.CanvasTexture | null {
  const canvas = paintFinish(id); if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas), tile = finishTile[id];
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  texture.repeat.set(width / tile.x, tile.y === 'full' ? 1 : height / tile.y);
  return texture;
}
interface Surfaces { back: THREE.MeshStandardMaterial; left: THREE.MeshStandardMaterial; floor: THREE.MeshStandardMaterial; planks: THREE.Object3D[]; closedFloor: THREE.Object3D }
/** Paints the walls and floor with the room's bought finish, or the scenery colour when it has none. */
export class FinishSurfaces {
  private choice: RoomFinishChoice = {};
  private textures: THREE.Texture[] = [];
  private readonly slab: THREE.Mesh;
  constructor(private surfaces: Surfaces) {
    // The open floor's top already maps world x/−z to UVs; this slab does the same where the plank floor is shown.
    const { minX, maxX, minZ, maxZ } = roomFloor, shape = new THREE.Shape();
    shape.moveTo(minX, -maxZ); shape.lineTo(maxX, -maxZ); shape.lineTo(maxX, -minZ); shape.lineTo(minX, -minZ); shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2); geometry.translate(0, .2225, 0);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3));
    this.slab = new THREE.Mesh(geometry, surfaces.floor); this.slab.receiveShadow = true; this.slab.visible = false; this.slab.name = 'finish-floor';
    surfaces.closedFloor.add(this.slab);
  }
  choose(choice: RoomFinishChoice, theme: Theme) {
    if (choice.wall === this.choice.wall && choice.floor === this.choice.floor) return;
    this.choice = { ...choice };
    this.textures.forEach(texture => texture.dispose()); this.textures = [];
    const { back, left, floor } = this.surfaces, { height } = roomWalls;
    this.map(back, choice.wall && finishTexture(choice.wall, roomSize.width, height));
    this.map(left, choice.wall && finishTexture(choice.wall, roomSize.depth - .1, height));
    const ground = this.map(floor, choice.floor && finishTexture(choice.floor, 1, 1));
    this.slab.visible = ground; this.surfaces.planks.forEach(plank => { plank.visible = !ground; });
    this.paint(theme);
  }
  paint(theme: Theme) {
    const { back, left, floor } = this.surfaces;
    for (const wall of [back, left]) wall.color.set(wall.map ? '#ffffff' : theme.wall);
    floor.color.set(floor.map ? '#ffffff' : theme.floor);
  }
  private map(material: THREE.MeshStandardMaterial, texture: THREE.Texture | null | undefined) {
    if (texture) this.textures.push(texture);
    if ((material.map === null) !== !texture) material.needsUpdate = true;
    material.map = texture ?? null;
    return Boolean(texture);
  }
  dispose() { this.textures.forEach(texture => texture.dispose()); this.slab.geometry.dispose(); }
}

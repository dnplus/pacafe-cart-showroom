import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHELF_SLOTS } from '../shared/cart';
import { bookshelf, shelfFrame, shelfSlot } from '../src/room/furnitureModels';

const read = (name: string) => readFileSync(new URL(`../public/furniture/${name}.glb`, import.meta.url));
const parse = async (name: string) => { const bytes = read(name); return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')).scene; };

/** The sha256 PA Cafe records for each file in assets/furniture/sources.json (commit 7d7b8364 of pa-cafe), so a copy cannot drift from its source. */
const recorded = {
  'terra-counter': '228374296d479e109b32f52a60785b454dbea5399b2914db3492d16219aad215',
  'atelier-archive-bookshelf': '9b11a579fc2a8e730ebf78a38499ea85827887059ff58c39cfb701a30764b744',
  'terra-plant': 'f2bbae54a06132a7f3ae18d6c195fed97367a86f6b7bcf9db779591a5133c030',
  'terra-plant-cactus': '7df23ed39e8235fc754ec467e48f11740431520c99a823306d806fbbd87d3a2d',
  'terra-rug-round': '419967e1dbceb6b1c0edd5dd6a6837ff87f872c260dd5ee8b6bfb474aa0086c6',
  'terra-rug-star': '194fb6967b17978aedebf4e0c6b5ed8ce8a8c08bbc535fbb64690acd903c5f8b',
  'terra-cash-register': '1dabc59dd3d0361aa82a0a317ceb6d590e68c55ce8982e301028fa2b45e492ef',
};

describe('the furniture copied from PA Cafe', () => {
  it.each(Object.entries(recorded))('%s is byte for byte the file PA Cafe records', (name, sha) => {
    expect(createHash('sha256').update(read(name)).digest('hex')).toBe(sha);
  });
});

describe('the shelf built from the archive bookcase', () => {
  const rays = async () => {
    const shelf = bookshelf(await parse('atelier-archive-bookshelf')); shelf.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = []; shelf.traverse(part => { if (part instanceof THREE.Mesh) meshes.push(part); });
    const hit = (from: [number, number, number], to: [number, number, number]) => {
      const origin = new THREE.Vector3(...from), direction = new THREE.Vector3(...to);
      return new THREE.Raycaster(origin, direction.normalize()).intersectObjects(meshes, false)[0]?.distance ?? Infinity;
    };
    return { meshes, hit };
  };
  it('has no books left in it', async () => {
    const { meshes } = await rays();
    expect(new Set(meshes.map(mesh => (mesh.material as THREE.Material).name))).toEqual(new Set(['oak', 'walnut']));
  });
  it('lets a product stand on a board with clear air above it and to both sides, in every slot', async () => {
    const { hit } = await rays();
    for (let slot = 0; slot < SHELF_SLOTS; slot++) {
      const at = shelfSlot(slot);
      const down = hit([at.x, at.y + .05, at.z], [0, -1, 0]);
      expect(down, `slot ${slot} floor`).toBeCloseTo(.05, 2);
      expect(hit([at.x, at.y + .01, at.z], [0, 1, 0]), `slot ${slot} ceiling`).toBeGreaterThanOrEqual(at.height - .01);
      for (const side of [-1, 1]) expect(hit([at.x, at.y + at.height / 2, at.z], [side, 0, 0]), `slot ${slot} side ${side}`).toBeGreaterThanOrEqual(at.width / 2 - .01);
      expect(hit([at.x, at.y + at.height / 2, at.z], [0, 0, -1]), `slot ${slot} back`).toBeGreaterThanOrEqual(at.depth / 2 - .01);
      expect(Math.abs(at.x) + at.width / 2).toBeLessThanOrEqual(shelfFrame.width / 2);
    }
  });
});

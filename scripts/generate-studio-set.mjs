// Builds the presenter studio set from three.js primitives and writes public/studio/showroom-set.glb. The model is
// original to this repository (Apache-2.0). src/room/studioSetVisual.ts needs these node names: host_desk,
// host_monitor, host_desktop_microphone, host_coffee_mug, host_desk_plant. Run: node scripts/generate-studio-set.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { root } from './lib/root.mjs';

// GLTFExporter reads its own Blob back through FileReader, which Node lacks; the set has no textures to encode.
globalThis.FileReader ??= class { readAsArrayBuffer(blob) { void blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); } };

const FLOOR = .2225, DESK_TOP = .75;
const materials = new Map();
const paint = (name, color, roughness = .7, metalness = 0) => { if (!materials.has(name)) materials.set(name, Object.assign(new THREE.MeshStandardMaterial({ color, roughness, metalness }), { name })); return materials.get(name); };
const part = (parent, geometry, material, x, y, z, rx = 0, ry = 0) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, 0); parent.add(mesh); return mesh; };
const box = (w, h, d, r = .02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3));
const group = (name, x, y, z) => { const node = new THREE.Group(); node.name = name; node.position.set(x, y, z); return node; };

const set = new THREE.Group(); set.name = 'showroom_presenter_set';

// The host sits behind the desk, on its -z side, facing the front camera at +z (src/room/studioSet.ts: host at z -.68).
const desk = group('host_desk', 0, 0, 0); set.add(desk);
part(desk, box(2.1, .06, .82), paint('desk_top', '#efe2c8', .45), 0, DESK_TOP - .03, 0);
part(desk, box(2.0, DESK_TOP - FLOOR - .06, .06), paint('desk_front', '#2f5d58', .6), 0, (FLOOR + DESK_TOP - .06) / 2, .36);
for (const x of [-.96, .96]) part(desk, box(.08, DESK_TOP - FLOOR - .06, .76), paint('desk_leg', '#7b4f33'), x, (FLOOR + DESK_TOP - .06) / 2, 0);
part(desk, box(1.7, .05, .06), paint('desk_stripe', '#e2b64f', .5), 0, (FLOOR + DESK_TOP) / 2 + .1, .395);

const monitor = group('host_monitor', -.82, DESK_TOP, .06); set.add(monitor);
part(monitor, new THREE.CylinderGeometry(.09, .1, .02, 24), paint('metal', '#3b3f45', .35, .4), 0, .01, 0);
part(monitor, box(.04, .26, .04), paint('metal', '#3b3f45', .35, .4), 0, .14, -.02);
const screen = part(monitor, box(.6, .36, .04), paint('bezel', '#22262b', .4), 0, .38, 0, 0, Math.PI - .35);
part(screen, new THREE.PlaneGeometry(.54, .3), paint('screen', '#9fd3e6', .2), 0, 0, .021);

const microphone = group('host_desktop_microphone', .1, DESK_TOP, .12); set.add(microphone);
part(microphone, new THREE.CylinderGeometry(.07, .08, .025, 24), paint('metal', '#3b3f45', .35, .4), 0, .0125, 0);
part(microphone, new THREE.CylinderGeometry(.012, .012, .2, 12), paint('metal', '#3b3f45', .35, .4), 0, .12, 0, -.35);
part(microphone, new THREE.CapsuleGeometry(.04, .1, 6, 16), paint('mic_head', '#d9d4cc', .4, .2), 0, .25, -.05, -.35);

const mug = group('host_coffee_mug', .55, DESK_TOP, .08); set.add(mug);
part(mug, new THREE.CylinderGeometry(.055, .048, .12, 24), paint('mug', '#e58f6b', .5), 0, .06, 0);
part(mug, new THREE.TorusGeometry(.035, .011, 8, 16), paint('mug', '#e58f6b', .5), .062, .062, 0, 0, Math.PI / 2);

const plant = group('host_desk_plant', .85, DESK_TOP, 0); set.add(plant);
part(plant, new THREE.CylinderGeometry(.07, .055, .1, 20), paint('pot', '#c7764c'), 0, .05, 0);
for (const [x, y, z, r] of [[0, .17, 0, .08], [.05, .22, .03, .06], [-.05, .21, -.02, .065]]) part(plant, new THREE.SphereGeometry(r, 14, 10), paint('leaf', '#5f8f4e', .8), x, y, z);

// Set dressing the room code does not move: the host's chair, a backdrop, a softbox and a floor mat.
const chair = group('host_chair', 0, 0, -.82); set.add(chair);
part(chair, box(.5, .08, .48), paint('chair', '#3f5a4c', .6), 0, FLOOR + .48, 0);
part(chair, box(.5, .55, .07), paint('chair', '#3f5a4c', .6), 0, FLOOR + .8, -.22);
part(chair, new THREE.CylinderGeometry(.03, .03, .4, 12), paint('metal', '#3b3f45', .35, .4), 0, FLOOR + .24, 0);
part(chair, new THREE.CylinderGeometry(.24, .24, .03, 24), paint('metal', '#3b3f45', .35, .4), 0, FLOOR + .015, 0);

const backdrop = group('backdrop', 0, 0, -1.45); set.add(backdrop);
part(backdrop, box(2.9, 2.5, .08), paint('backdrop', '#2f5d58', .8), 0, FLOOR + 1.25, 0);
for (const [y, color] of [[1.9, '#e2b64f'], [1.75, '#e58f6b']]) part(backdrop, box(2.9, .06, .02), paint(`band_${color.slice(1)}`, color, .6), 0, FLOOR + y, .05);
part(backdrop, box(.9, .3, .03), paint('sign', '#fff4dc', .5), 0, FLOOR + 2.25, .055);
for (const x of [-1.38, 1.38]) part(backdrop, box(.1, .12, .3), paint('foot', '#22262b', .5), x, FLOOR + .06, .1);

const softbox = group('softbox', -1.65, 0, .7); set.add(softbox);
part(softbox, new THREE.CylinderGeometry(.015, .015, 1.7, 10), paint('metal', '#3b3f45', .35, .4), 0, FLOOR + .85, 0);
for (const a of [0, 2.1, 4.2]) part(softbox, new THREE.CylinderGeometry(.012, .012, .45, 8), paint('metal', '#3b3f45', .35, .4), Math.sin(a) * .16, FLOOR + .19, Math.cos(a) * .16, Math.cos(a) * .5, 0);
part(softbox, box(.55, .42, .2), paint('softbox', '#fbf6ea', .3), 0, FLOOR + 1.75, 0, -.15, .6);

const mat = part(set, new THREE.CylinderGeometry(1.5, 1.5, .012, 48), paint('floor_mat', '#d9b8e0', .95), 0, FLOOR + .006, -.4);
mat.name = 'floor_mat';

const glb = await new GLTFExporter().parseAsync(set, { binary: true });
const out = path.join(root, 'public/studio/showroom-set.glb');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(glb));
console.log(path.relative(root, out), fs.statSync(out).size, 'bytes');

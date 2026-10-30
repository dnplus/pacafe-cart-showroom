// Renders Kenney's CC0 platformer character (assets/third-party/kenney-platformer-kit) to the clerk's transparent
// full-body standee and square portrait in public/art/characters, with three.js in headless Chromium.
// Run: node scripts/render-character.mjs (needs Playwright's Chromium: npx playwright-core install chromium).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './lib/browser.mjs';
import { serve } from './lib/static-server.mjs';
import { root } from './lib/root.mjs';

const kit = 'assets/third-party/kenney-platformer-kit';
const expected = { 'character.glb': '7112f6a08400914f9da546f3e6029e947cc9eab2b4a6da5eb99776111289efb1', 'Textures/colormap.png': '106cf02e0d6dccded6d9f90c2ae6a51eb94c6301645fea159e834c44ed4708a3' };
for (const [file, sha] of Object.entries(expected)) {
  const actual = createHash('sha256').update(fs.readFileSync(path.join(root, kit, file))).digest('hex');
  if (actual !== sha) throw new Error(`${kit}/${file} is not the CC0 file this script was made for (sha256 ${actual})`);
}

const page = `<!doctype html><html><body style="margin:0;background:transparent">
<script type="importmap">{ "imports": { "three": "/node_modules/three/build/three.module.js", "three/addons/": "/node_modules/three/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
window.render = async () => {
  const gltf = await new GLTFLoader().loadAsync('/${kit}/character.glb');
  const model = gltf.scene;
  // The 'idle' clip at its first frame: arms down, the pose a clerk stands in behind the counter.
  const mixer = new THREE.AnimationMixer(model), idle = gltf.animations.find(clip => clip.name === 'idle');
  if (idle) { mixer.clipAction(idle).play(); mixer.setTime(0); }
  model.rotation.y = -.35; model.updateMatrixWorld(true);
  const scene = new THREE.Scene(); scene.add(model);
  scene.add(new THREE.HemisphereLight('#fff6e8', '#b98a6a', 2.2));
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(2, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffe2c4', 1.1); rim.position.set(-4, 3, -2); scene.add(rim);
  const body = new THREE.Box3().setFromObject(model);
  const shot = (width, height, box, margin) => {
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const half = Math.max(size.y / 2, size.x / 2 * height / width) * (1 + margin);
    const camera = new THREE.OrthographicCamera(-half * width / height, half * width / height, half, -half, .1, 100);
    camera.position.set(centre.x, centre.y + size.y * .08, centre.z + 10); camera.lookAt(centre.x, centre.y, centre.z);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png'); renderer.dispose(); return url;
  };
  const head = body.clone(); head.min.y = body.max.y - (body.max.y - body.min.y) * .55;
  return { standee: shot(512, 1024, body, .04), portrait: shot(256, 256, head, .08) };
};
window.ready = true;
</script></body></html>`;

const server = await serve(root, { '/__render-character.html': page });
const browser = await launchBrowser();
try {
  const tab = await browser.newPage();
  const problems = []; tab.on('pageerror', error => problems.push(error.message));
  await tab.goto(`${server.origin}/__render-character.html`);
  await tab.waitForFunction(() => window.ready === true);
  const images = await tab.evaluate(() => window.render());
  if (problems.length) throw new Error(problems.join('\n'));
  const out = path.join(root, 'public/art/characters');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, url] of Object.entries(images)) {
    const file = path.join(out, `clerk-${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(path.relative(root, file), fs.statSync(file).size, 'bytes');
  }
} finally { await browser.close(); await server.close(); }

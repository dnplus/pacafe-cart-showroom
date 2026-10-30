// Renders Kenney's CC0 platformer character (assets/third-party/kenney-platformer-kit) to the clerk's transparent
// full-body standee and square portrait in public/art/characters, with three.js in headless Chromium. Each variant
// is the same model with the purple palette cells turned to another hue (CC0 allows changing it); the orange face stays.
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

const variants = [{ id: 'clerk', hue: 0 }, { id: 'clerk-mint', hue: -125 }];

const page = `<!doctype html><html><body style="margin:0;background:transparent">
<script type="importmap">{ "imports": { "three": "/node_modules/three/build/three.module.js", "three/addons/": "/node_modules/three/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const turnPurple = (image, degrees) => {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]].map(v => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
    if (c < .08) continue;
    let h = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4; h *= 60;
    if (h < 240 || h > 300) continue;
    const l = (max + min) / 2, s = c / (1 - Math.abs(2 * l - 1)), to = (h + degrees + 360) % 360;
    const k = n => { const a = (n + to / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(a - 3, 9 - a, 1)); };
    d[i] = Math.round(k(0) * 255); d[i + 1] = Math.round(k(8) * 255); d[i + 2] = Math.round(k(4) * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace;
  return map;
};
window.render = async hue => {
  const gltf = await new GLTFLoader().loadAsync('/${kit}/character.glb');
  const model = gltf.scene;
  if (hue) model.traverse(part => { if (part.isMesh && part.material.map) { part.material = part.material.clone(); part.material.map = turnPurple(part.material.map.image, hue); } });
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
  const out = path.join(root, 'public/art/characters');
  fs.mkdirSync(out, { recursive: true });
  for (const { id, hue } of variants) {
    const images = await tab.evaluate(degrees => window.render(degrees), hue);
    if (problems.length) throw new Error(problems.join('\n'));
    for (const [name, url] of Object.entries(images)) {
      const file = path.join(out, `${id}-${name}.png`);
      fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      console.log(path.relative(root, file), fs.statSync(file).size, 'bytes');
    }
  }
} finally { await browser.close(); await server.close(); }

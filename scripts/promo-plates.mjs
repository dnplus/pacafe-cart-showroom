// Photographs the studio set for the promo: opens plates.html on Vite's dev server in headless Chromium and writes, per shot,
// the room without its figures, the desk alone on a clear background, and where the owner stands, to runner/composition/plates/.
// Run after changing the room or the set: node scripts/promo-plates.mjs (needs Playwright's Chromium, as scripts/screenshots.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { launchBrowser } from './lib/browser.mjs';
import { root } from './lib/root.mjs';

const out = path.join(root, 'runner/composition/plates');
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 5199, strictPort: true } });
await server.listen();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto('http://127.0.0.1:5199/plates.html');
  const plates = await page.evaluate(() => window.plates());
  if (problems.length) throw new Error(problems.join('\n'));
  const layout = {};
  for (const [name, plate] of Object.entries(plates)) {
    for (const layer of ['back', 'front']) fs.writeFileSync(path.join(out, `${name}-${layer}.png`), Buffer.from(plate[layer].split(',')[1], 'base64'));
    layout[name] = { feet: { x: Math.round(plate.feet.x * 10) / 10, y: Math.round(plate.feet.y * 10) / 10 }, pxPerMetre: Math.round(plate.pxPerMetre * 10) / 10 };
  }
  fs.writeFileSync(path.join(out, 'plates.json'), `${JSON.stringify(layout, null, 2)}\n`);
  console.log(layout);
} finally {
  await browser.close(); await server.close();
}

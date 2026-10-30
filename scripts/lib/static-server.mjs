import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };

/** Serves `root` read-only on 127.0.0.1, plus `pages` (path → HTML) for the scripts' own throwaway pages. */
export function serve(root, pages = {}) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://local');
    if (pages[url.pathname]) { response.writeHead(200, { 'content-type': 'text/html' }); response.end(pages[url.pathname]); return; }
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) })));
}

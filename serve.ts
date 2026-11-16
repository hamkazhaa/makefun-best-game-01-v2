// Minimal static server for playing Harbour Line locally: serves game/
// at http://localhost:8080 (or $PORT). Standard library only.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'game');
const port = Number(process.env.PORT ?? 8080);
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

const server = createServer((req, res) => {
  const raw = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const path = normalize(join(root, raw));
  const ok = path.startsWith(root) && existsSync(path) && statSync(path).isFile();
  if (!ok) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': mime.get(extname(path)) ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
});

server.listen(port, () => console.log(`Harbour Line at http://localhost:${port}`));

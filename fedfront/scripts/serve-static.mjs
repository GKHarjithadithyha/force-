// Minimal static server for the production export (out/). No dependencies, any OS.
// Usage: node scripts/serve-static.mjs [dir=out] [port=3200]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'out');
const port = Number(process.argv[3] ?? 3200);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '');
  const base = join(root, clean);
  if (base !== root && !base.startsWith(root + sep)) return null; // no path traversal
  for (const candidate of [base, join(base, 'index.html'), `${base}.html`]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* try the next form */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const file = (await resolveFile(req.url ?? '/')) ?? join(root, '404.html');
  try {
    const body = await readFile(file);
    const found = !file.endsWith('404.html') || (req.url ?? '').includes('404');
    res.writeHead(found ? 200 : 404, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Serving ${root} at http://127.0.0.1:${port}\n`);
});

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED } from './render.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const check = process.argv.includes('--check');
let stale = 0;
for (const g of GENERATED) {
  const abs = resolve(root, g.path);
  const next = g.render();
  if (check) {
    const cur = existsSync(abs) ? readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== next) {
      console.error(`STALE: ${g.path} (run npm run gen:protocol)`);
      stale++;
    }
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, next, 'utf8');
    console.log(`wrote ${g.path}`);
  }
}
if (stale > 0) process.exit(1);

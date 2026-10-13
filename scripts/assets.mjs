import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
const BINARY = new Set(['.png']);

export async function readAssets(root) {
  const assets = Object.create(null);
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '_headers') continue;
      const pathname = `${prefix}/${entry.name}`;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path, pathname);
      else if (entry.isFile()) {
        const extension = extname(entry.name);
        const type = TYPES[extension];
        if (!type) throw new Error(`Unsupported static asset: ${pathname}`);
        assets[pathname] = { body: await readFile(path, BINARY.has(extension) ? null : 'utf8'), type };
      }
    }
  }
  await visit(root);
  return assets;
}

import { build as buildWorker } from 'esbuild';
import { build as buildFrontend } from 'vite';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BADGE_LANGUAGES } from '../src/lib/badges.js';
import { withLinkPreview } from '../src/lib/link-preview.js';
import { giftPath } from '../src/lib/routes.js';

const publicDir = new URL('../dist/public/', import.meta.url);
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await buildFrontend();
await buildWorker({ entryPoints: ['worker/cloudflare.js'], outfile: 'dist/worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });

// One shell per share language. Cloudflare serves gift/en.html for /gift/en,
// so a link preview costs a static file instead of a Worker request.
const shell = await readFile(new URL('index.html', publicDir), 'utf8');
for (const badge of BADGE_LANGUAGES) {
  const file = new URL(`.${giftPath(false, badge.value)}.html`, publicDir);
  await mkdir(dirname(fileURLToPath(file)), { recursive: true });
  await writeFile(file, withLinkPreview(shell, badge));
}
// Stripe redirects straight to this page. Its shell must work before JavaScript
// runs, and browser-local receipts should not appear in search results.
for (const path of ['/thanks/stripe', '/preview/thanks/stripe']) {
  const file = new URL(`.${path}.html`, publicDir);
  await mkdir(dirname(fileURLToPath(file)), { recursive: true });
  await writeFile(file, shell.replace('</head>', '  <meta name="robots" content="noindex, nofollow" />\n</head>'));
}
console.log(`Built Svelte frontend, ${BADGE_LANGUAGES.length} share shells, Stripe return shells and the Worker; runtime credentials remain server-side.`);

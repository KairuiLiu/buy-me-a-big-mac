import { build as buildWorker } from 'esbuild';
import { build as buildFrontend } from 'vite';
import { mkdir, rm } from 'node:fs/promises';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await buildFrontend();
await buildWorker({ entryPoints: ['worker/cloudflare.js'], outfile: 'dist/worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
console.log('Built Svelte frontend and Worker; runtime credentials remain server-side.');

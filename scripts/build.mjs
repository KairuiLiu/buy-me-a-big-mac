import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await build({ entryPoints: ['worker/cloudflare.js'], outfile: 'dist/worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
await cp(new URL('../public/', import.meta.url), new URL('../dist/public/', import.meta.url), { recursive: true });
console.log('Built Worker and static assets without environment substitution.');

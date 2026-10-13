import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { withLinkPreview } from './src/lib/link-preview.js';

export default defineConfig({
  plugins: [
    svelte(),
    // The default shell previews the project; scripts/build.mjs writes the
    // per-language share shells from this output.
    { name: 'link-preview', transformIndexHtml: (html: string) => withLinkPreview(html) },
  ],
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.dev.vars', '**/.dev.vars.*', '**/.secrets*'],
    },
  },
});

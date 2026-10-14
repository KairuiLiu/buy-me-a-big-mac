// Offline generation: run render-carousel-preview.py first, then this script.
// Requires ffmpeg on PATH; the committed assets need no encoder during builds.
import { execFileSync } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getBadgeLanguage } from '../src/lib/badges.js';

const asset = name => fileURLToPath(new URL(`../public${name}`, import.meta.url));
const carousel = getBadgeLanguage('carousel');
await copyFile(asset(getBadgeLanguage('zh-CN').card), asset(carousel.card));
execFileSync('ffmpeg', [
  '-v', 'error', '-y', '-ignore_loop', '1',
  '-i', asset('/assets/card-carousel-aligned.gif'),
  '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21',
  '-movflags', '+faststart', '-r', '30', asset(carousel.video),
], { stdio: 'inherit' });
console.log('Generated the carousel PNG poster and H.264 MP4 preview.');

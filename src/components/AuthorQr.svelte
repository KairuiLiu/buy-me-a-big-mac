<script lang="ts">
  import QRCode from 'qrcode';
  import { validateAfdianId } from '../lib/domain.js';

  let { afdianId }: { afdianId: string } = $props();
  const url = $derived(`https://afdian.com/u/${validateAfdianId(afdianId)}`);
  const qr = $derived.by(() => {
    const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const cells = [];
    for (let row = 0; row < modules.size; row++) {
      for (let column = 0; column < modules.size; column++) {
        if (modules.get(row, column)) cells.push(`M${column + 4} ${row + 4}h1v1h-1z`);
      }
    }
    return { size: modules.size + 8, path: cells.join('') };
  });
</script>

<a class="author-qr" href={url} target="_blank" rel="noopener noreferrer" aria-label="打开作者的爱发电主页">
  <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="作者爱发电主页二维码" shape-rendering="crispEdges">
    <rect width={qr.size} height={qr.size} fill="#fff" />
    <path d={qr.path} fill="#000" />
  </svg>
  <span>作者的爱发电</span>
</a>

<style>
  .author-qr { display: flex; flex-direction: column; align-items: center; gap: 7px; width: fit-content; margin: auto; color: var(--muted); font-size: 10px; }
  svg { display: block; width: 112px; height: 112px; }
  .author-qr:hover { color: var(--ink); }
  .author-qr:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; }
</style>

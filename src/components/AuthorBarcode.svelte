<script lang="ts">
  import { validateAfdianId } from '../lib/domain.js';
  import OrderBarcode from './OrderBarcode.svelte';

  let { afdianId }: { afdianId: string } = $props();
  const id = $derived(validateAfdianId(afdianId));
</script>

<a class="author-barcode" href={`https://afdian.com/u/${id}`} target="_blank" rel="noopener noreferrer" aria-label="打开作者的爱发电主页">
  <OrderBarcode value={id} label="作者爱发电 ID" />
  <span>作者的爱发电</span>
</a>

<style>
  .author-barcode { display: flex; flex-direction: column; align-items: center; gap: 7px; width: 100%; color: var(--muted); font-size: 10px; }
  .author-barcode:hover { color: var(--ink); }
  .author-barcode:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; }
</style>

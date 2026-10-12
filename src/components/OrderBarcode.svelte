<script lang="ts">
  import JsBarcode from 'jsbarcode';

  let { value }: { value: string } = $props();

  const barcode = $derived.by(() => {
    if (!value) return null;
    const output: { encodings?: { data: string }[] } = {};
    try {
      JsBarcode(output, value, { format: 'CODE128', displayValue: false });
      const modules = output.encodings?.map((encoding) => encoding.data).join('') || '';
      if (!/^[01]+$/.test(modules)) return null;
      // Keep the Code 128 quiet zone at ten modules on each side.
      const bars = Array.from(modules.matchAll(/1+/g), (match) => ({
        x: match.index + 10,
        width: match[0].length,
      }));
      return { width: modules.length + 20, bars };
    } catch {
      return null;
    }
  });
</script>

{#if barcode}
  <svg
    class="order-barcode"
    role="img"
    aria-label={`订单号 ${value} 的 Code 128 条形码`}
    viewBox={`0 0 ${barcode.width} 58`}
    preserveAspectRatio="none"
    shape-rendering="crispEdges"
  >
    <rect x="0" y="0" width={barcode.width} height="58" fill="#fff" />
    {#each barcode.bars as bar (bar.x)}
      <rect x={bar.x} y="4" width={bar.width} height="50" fill="#000" />
    {/each}
  </svg>
{:else}
  <p class="barcode-unavailable">该订单号暂无法生成条形码</p>
{/if}

<style>
  .order-barcode { display: block; width: 100%; height: 58px; }
  .barcode-unavailable { margin: 0; color: var(--muted); text-align: center; font: 10px/1.8 var(--mono); }
</style>

<script lang="ts">
  import type { AppController } from '../lib/types';
  import Spinner from './Spinner.svelte';

  let { controller, dock = false }: { controller: AppController; dock?: boolean } = $props();
  let view = $derived(controller.state);
</script>

<button
  type="button"
  class="button primary"
  class:full={!dock}
  class:docked={dock}
  data-action={dock ? 'pay-mobile' : 'pay'}
  disabled={!view.quote || !view.cart.length || Boolean(view.busy)}
  onclick={() => controller.choosePayment()}
>
  {#if view.busy === 'payment'}<Spinner />{/if}
  {view.busy === 'payment' ? '正在打开…' : '就这样'}
</button>

<style>
  .button { min-height: 48px; }
  .docked { min-width: 94px; min-height: 46px; padding: 10px 14px; border-radius: 0; box-shadow: none; font-size: 13px; }
</style>

<script lang="ts">
  import { validateAfdianId } from '../lib/domain.js';
  import OrderBarcode from './OrderBarcode.svelte';

  let { afdianId }: { afdianId: string } = $props();
  const id = $derived(validateAfdianId(afdianId));
</script>

<OrderBarcode value={id} label="作者爱发电 ID" />

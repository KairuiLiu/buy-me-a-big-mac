<script lang="ts">
  import type { Product } from '../lib/types';
  import { formatMoney, safeHttpsUrl } from '../lib/domain.js';
  import Icon from './Icon.svelte';

  interface Props {
    product: Product;
    quantity: number;
    busy: boolean;
    preview: boolean;
    number?: number;
    onQuantity: (code: string, delta: 1 | -1) => void;
  }

  let { product, quantity, busy, preview, number = 1, onQuantity }: Props = $props();
  const placeholder = './assets/food-placeholder.svg';
  let failedImage = $state<string | null>(null);
  let imageUrl = $derived(
    preview && typeof product.image === 'string' && /^\/assets\/demo-[a-z-]+\.svg$/.test(product.image)
      ? product.image
      : safeHttpsUrl(product.image) || placeholder
  );
  let imageSource = $derived(failedImage === imageUrl ? placeholder : imageUrl);

  function handleImageError() {
    if (imageSource !== placeholder) failedImage = imageUrl;
  }
</script>

<article class="product-card" class:in-cart={quantity > 0}>
  <div class="product-card-top">
    <span>№ {String(number).padStart(2, '0')}</span>
    {#if quantity}
      <span class="quantity-flag"><Icon name="check" /> 已选 {quantity}</span>
    {:else}
      <span class="product-tag">{product.discountType || '一份小小的心意'}</span>
    {/if}
  </div>

  <div class="product-image">
    <img
      src={imageSource}
      alt={product.name}
      loading="lazy"
      referrerpolicy="no-referrer"
      onerror={handleImageError}
    />
  </div>

  <div class="product-content">
    <h3>{product.name}</h3>
    <div class="product-bottom">
      <span class="product-price"><small>¥</small>{formatMoney(product.priceCents)}</span>
      <div class="product-quantity">
        {#if quantity}
          <button
            class="subtract-button"
            data-action="remove"
            data-code={product.code}
            aria-label={`减少${product.name}`}
            disabled={busy}
            onclick={() => onQuantity(product.code, -1)}
          ><Icon name="minus" /></button>
          <b>{quantity}</b>
        {/if}
        <button
          class="add-button"
          data-action="add"
          data-code={product.code}
          aria-label={`添加${product.name}`}
          disabled={busy || quantity >= 20 || !Number.isSafeInteger(product.priceCents) || product.priceCents < 0}
          onclick={() => onQuantity(product.code, 1)}
        ><Icon name="plus" /></button>
      </div>
    </div>
  </div>
</article>

<script lang="ts">
  import type { AppController } from '../lib/types';
  import Icon from './Icon.svelte';
  import ProductCard from './ProductCard.svelte';

  let { controller }: { controller: AppController } = $props();
  let state = $derived(controller.state);
  let menu = $derived(state.menu);
  let tabs = $derived([
    { name: '全部餐品', index: -1 },
    ...(menu?.categories.map((category, index) => ({
      name: category.name === '全部' ? '餐厅全部' : category.name,
      index,
    })) || []),
  ]);
  let products = $derived.by(() => {
    const category = menu?.categories[state.category];
    return menu?.products.filter((product) =>
      (state.category === -1 || category?.codes.includes(product.code)) &&
      product.name.toLowerCase().includes(state.search.toLowerCase())
    ) || [];
  });
</script>

<div class="menu-browser">
  <nav class="category-rail" aria-label="餐品分类">
    <h2 class="rail-title">今日菜单</h2>
    <div class="categories">
      {#each tabs as tab, index (tab.index)}
        <button
          class:active={state.category === tab.index}
          data-action="category"
          data-index={tab.index}
          aria-pressed={state.category === tab.index}
          disabled={Boolean(state.busy)}
          onclick={() => controller.setCategory(tab.index)}
        >
          <span>{String(index).padStart(2, '0')}</span>
          <b>{tab.name}</b>
          <Icon name="arrow" />
        </button>
      {/each}
    </div>
  </nav>

  <div class="menu-content">
    <div class="menu-tools">
      <div>
        <h2>{state.category === -1 ? '全部餐品' : menu?.categories[state.category]?.name}</h2>
      </div>
      <div class="input-icon menu-search">
        <Icon name="search" />
        <input
          type="search"
          id="meal-search"
          value={state.search}
          placeholder="搜索餐品"
          aria-label="搜索餐品"
          oninput={(event) => controller.setSearch(event.currentTarget.value)}
        />
      </div>
    </div>

    <div id="product-grid" class="product-grid">
      {#each products as product (product.code)}
        <ProductCard
          {product}
          number={(menu?.products.indexOf(product) ?? 0) + 1}
          quantity={state.cart.find((item) => item.code === product.code)?.quantity || 0}
          busy={Boolean(state.busy)}
          preview={state.preview}
          onQuantity={(code, delta) => controller.changeQuantity(code, delta)}
        />
      {:else}
        <div class="empty-state no-products">
          <strong>暂时没有匹配的餐品</strong>
          <p>试试其他关键词或分类。</p>
        </div>
      {/each}
    </div>

  </div>
</div>

<style>
  .menu-browser { grid-template-columns: 152px minmax(0, 1fr); }
  .rail-title { margin: 0; padding: 0 12px 24px; font: 700 16px/1.5 var(--sans); }
  .categories button, .categories button.active {
    grid-template-columns: 20px minmax(0, 1fr) 12px;
    padding: 18px 12px;
    gap: 8px;
  }
  .categories button b { font-weight: 600; }
  .menu-tools { min-height: 80px; }
  @media (min-width: 761px) and (max-width: 1100px) {
    .menu-browser { grid-template-columns: 122px minmax(0, 1fr); }
    .categories button, .categories button.active { grid-template-columns: 16px minmax(0, 1fr); padding-inline: 10px; gap: 6px; }
    .categories button :global(.icon) { display: none; }
    .rail-title { font-size: 14px; padding-inline: 10px; }
  }
  @media (max-width: 760px) {
    .rail-title { display: block; padding: 18px 0 12px; font-size: 16px; }
    .categories button, .categories button.active { display: flex; padding: 14px 16px; gap: 7px; font-size: 12px; }
    .menu-tools { gap: 12px; flex-wrap: nowrap; padding: 18px 12px; }
    .menu-tools > div:first-child { width: auto; flex: 1; }
    .menu-search { width: 48%; }
    .menu-search input { font-size: 16px; }
  }
</style>

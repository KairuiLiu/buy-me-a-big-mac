<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AppController } from '../lib/types';
  import Icon from './Icon.svelte';
  import ProductCard from './ProductCard.svelte';

  let { controller }: { controller: AppController } = $props();
  let browserElement: HTMLDivElement | undefined = $state();
  let isMobile = $state(false);
  let appState = $derived(controller.state);
  let menu = $derived(appState.menu);
  let tabs = $derived([
    { name: '全部餐品', index: -1 },
    ...(menu?.categories.map((category, index) => ({
      name: category.name === '全部' ? '餐厅全部' : category.name,
      index,
    })) || []),
  ]);
  let products = $derived.by(() => {
    const category = menu?.categories[appState.category];
    return menu?.products.filter((product) =>
      (appState.category === -1 || category?.codes.includes(product.code)) &&
      (isMobile || product.name.toLowerCase().includes(appState.search.toLowerCase()))
    ) || [];
  });

  onMount(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const updateMobile = () => { isMobile = media.matches; };
    updateMobile();
    media.addEventListener('change', updateMobile);
    return () => media.removeEventListener('change', updateMobile);
  });

  async function selectCategory(index: number) {
    // Keep the new category below the sticky tabs when changing it midway down the menu.
    const menuTop = browserElement ? browserElement.getBoundingClientRect().top + window.scrollY : 0;
    const wasPastHeading = isMobile && window.scrollY > menuTop;
    controller.setCategory(index);
    if (wasPastHeading) {
      await tick();
      window.scrollTo({ top: menuTop, behavior: 'instant' });
    }
  }
</script>

<div class="menu-browser" bind:this={browserElement}>
  <nav class="category-rail" aria-label="餐品分类">
    <h2 class="rail-title">今日菜单</h2>
    <div class="categories">
      {#each tabs as tab, index (tab.index)}
        <button
          class:active={appState.category === tab.index}
          data-action="category"
          data-index={tab.index}
          aria-pressed={appState.category === tab.index}
          disabled={Boolean(appState.busy)}
          onclick={() => selectCategory(tab.index)}
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
        <h2>{appState.category === -1 ? '全部餐品' : menu?.categories[appState.category]?.name}</h2>
      </div>
      <div class="input-icon menu-search">
        <Icon name="search" />
        <input
          type="search"
          id="meal-search"
          value={appState.search}
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
          quantity={appState.cart.find((item) => item.code === product.code)?.quantity || 0}
          busy={Boolean(appState.busy)}
          preview={appState.preview}
          onQuantity={(code, delta) => controller.changeQuantity(code, delta)}
        />
      {:else}
        <div class="empty-state no-products">
          <strong>暂时没有匹配的餐品</strong>
          <p>{isMobile ? '试试其他分类。' : '试试其他关键词或分类。'}</p>
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
    .category-rail { border-bottom-color: var(--line); }
    .rail-title { display: none; }
    .categories button, .categories button.active { display: flex; justify-content: center; flex: 1 0 auto; padding: 13px 12px; border: 0; background: transparent; font-size: 13px; }
    .categories button.active { color: var(--red); }
    .categories button.active::after { content: ''; position: absolute; inset: auto 12px 0; height: 3px; background: var(--red); }
    .categories button > span, .categories button :global(.icon) { display: none; }
    .menu-tools { display: none; }
  }
</style>

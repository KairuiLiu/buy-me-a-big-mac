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
    <span class="rail-title">MENU<br /><b>选点好吃的</b></span>
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
    <span class="rail-bottom">GOOD<br />FOOD.<br /><span>GOOD<br />MOOD.</span></span>
  </nav>

  <div class="menu-content">
    <div class="menu-banner">
      <div>
        <span class="eyebrow">A LITTLE TREAT GOES A LONG WAY.</span>
        <h2>今天，<br />请你吃好一点。</h2>
        <p>谢谢你的好代码，这一餐我请。</p>
      </div>
      <img src="./assets/hero-burger.svg" alt="汉堡、薯条和饮料" />
      <span class="banner-star" aria-hidden="true">✳</span>
    </div>

    <div class="menu-tools">
      <div>
        <h2>{state.category === -1 ? '全部餐品' : menu?.categories[state.category]?.name}</h2>
        <span>菜单参考价 · {state.preview ? '示例价格' : '供应以餐厅为准'}</span>
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

    <div class="menu-footnote">
      <p>
        {state.preview
          ? '当前为示例菜单，用于体验选餐与赞助流程。'
          : '菜单和建议金额由麦当劳 MCP 查询，优惠以查询账号为准，实际购买价格可能不同。'}
        <br />这里送出的是赞助心意，不会向餐厅下单。
      </p>
      <button
        class="text-button"
        data-action="reconnect"
        disabled={Boolean(state.busy)}
        onclick={() => controller.loadGiftMenu()}
      >刷新菜单 ↻</button>
    </div>
  </div>
</div>

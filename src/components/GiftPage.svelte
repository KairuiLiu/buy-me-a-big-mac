<script lang="ts">
  import type { AppController } from '../lib/types';
  import { formatMoney } from '../lib/domain.js';
  import ErrorBox from './ErrorBox.svelte';
  import Icon from './Icon.svelte';
  import MealReceipt from './MealReceipt.svelte';
  import MenuBrowser from './MenuBrowser.svelte';
  import Spinner from './Spinner.svelte';
  import Steps from './Steps.svelte';

  let { controller }: { controller: AppController } = $props();
  let state = $derived(controller.state);
  let config = $derived(state.config);
  let count = $derived(state.cart.reduce((total, item) => total + item.quantity, 0));
</script>

{#if state.badLink || !config}
  <main class="wrap invalid-page" id="main">
    <span class="eyebrow">404 / TABLE NOT FOUND</span>
    <h1>这个请客链接不太对。</h1>
    <p>链接可能不完整或版本不受支持，请向项目作者获取完整链接。</p>
    <a
      class="button primary"
      href={state.preview ? '#/preview/create' : '#create'}
      data-action="home"
      onclick={(event) => { event.preventDefault(); controller.home(); }}
    >创建我的入口 <Icon name="arrow" /></a>
  </main>
{:else}
  <main class="wrap gift-page" id="main">
    <section class="gift-heading">
      <div class="gift-heading-copy">
        <span class="eyebrow">THE OPEN SOURCE CANTEEN / 开源小餐厅</span>
        <h1>给 <span>{config.repo.split('/')[0]}</span>，加个餐。</h1>
        <p>
          感谢
          <a href={`https://github.com/${config.repo}`} target="_blank" rel="noopener noreferrer">
            <Icon name="github" />{config.repo.split('/')[1]} <Icon name="external" />
          </a>，让代码生活好了一点。
        </p>
      </div>
      <div class="store-panel">
        <span class="eyebrow">TODAY’S REFERENCE STORE</span>
        <strong><Icon name="pin" />{config.storeName}</strong>
        <p>按这家餐厅的菜单选餐，心意送给作者。</p>
        <span class="store-type">
          {config.beType === 5 ? '得来速菜单' : '到店菜单'} <i></i>
          {state.preview ? '示例餐厅' : '麦当劳 MCP'}
        </span>
      </div>
    </section>

    <div class="order-strip">
      <span class="eyebrow">MAKE A MEAL, MAKE THEIR DAY.</span>
      <Steps items={['选一顿好饭', '确认这份心意', '送一句谢谢']} active={state.confirmed ? 3 : state.cart.length ? 2 : 1} />
    </div>

    <div class="gift-grid">
      <section class="menu-area" aria-label="餐厅菜单">
        {#if state.menu}
          <MenuBrowser {controller} />
        {:else}
          <div class="panel connect-panel">
            <span class="connect-symbol">
              {#if state.busy === 'menu'}<Spinner />{:else}<Icon name="heart" />{/if}
            </span>
            <div class="panel-heading">
              <span class="eyebrow">PREPARING YOUR MENU</span>
              <h2>{state.error ? '菜单暂时没准备好。' : '好吃的，正在路上。'}</h2>
              <p>
                {state.error
                  ? '重新加载试试，餐单会在连接成功后显示。'
                  : '正在读取这家餐厅的菜单，请稍等片刻。'}
              </p>
            </div>
            <ErrorBox message={state.error} />
            <button
              type="button"
              data-action="load-menu"
              class="button primary"
              disabled={Boolean(state.busy)}
              onclick={() => controller.loadGiftMenu()}
            >
              {#if state.busy === 'menu'}
                <Spinner />正在读取菜单…
              {:else}
                重新加载菜单 <Icon name="arrow" />
              {/if}
            </button>
          </div>
        {/if}
      </section>
      <MealReceipt {controller} />
    </div>

    <button class="mobile-cart-bar" data-action="view-cart" onclick={() => controller.scrollTo('your-meal')}>
      <Icon name="heart" />
      <span>我的餐单 <b>{count}</b></span>
      <strong>{state.quote ? '¥' + formatMoney(state.quote.amountCents) : '查看餐单'}</strong>
      <Icon name="arrow" />
    </button>
  </main>
{/if}

<script lang="ts">
  import type { AppController } from '../lib/types';
  import { formatMoney } from '../lib/domain.js';
  import { createPath } from '../lib/routes.js';
  import ErrorBox from './ErrorBox.svelte';
  import Icon from './Icon.svelte';
  import ReceiptPrinter from './ReceiptPrinter.svelte';
  import MealReceipt from './MealReceipt.svelte';
  import SponsorshipButton from './SponsorshipButton.svelte';
  import MenuBrowser from './MenuBrowser.svelte';
  import Spinner from './Spinner.svelte';

  let { controller }: { controller: AppController } = $props();
  let state = $derived(controller.state);
  let config = $derived(state.config);
</script>

{#if state.badLink || !config}
  <main class="wrap invalid-page" id="main">
    <span class="eyebrow">404 / TABLE NOT FOUND</span>
    <h1>这个赞助链接不太对。</h1>
    <p>链接可能不完整或版本不受支持，请向发起者获取完整链接。</p>
    <a
      class="button primary"
      href={createPath(state.preview)}
      data-action="home"
      onclick={(event) => { event.preventDefault(); controller.home(); }}
    >创建我的入口 <Icon name="arrow" /></a>
  </main>
{:else}
  <main class="wrap gift-page" id="main">
    <section class="gift-heading">
      <div class="gift-heading-copy">
        <h1>请{config.sponsorType === 'person' ? config.name : config.repo.split('/')[0]}吃份巨无霸</h1>
        {#if config.sponsorType !== 'person'}
          <p>
            感谢他的
            <a href={`https://github.com/${config.repo}`} target="_blank" rel="noopener noreferrer">
              {config.repo.split('/')[1]}
            </a> 项目
          </p>
        {/if}
      </div>
    </section>

    <div class="gift-grid">
      <section class="menu-area" aria-label="餐厅菜单">
        {#if state.menu}
          <MenuBrowser {controller} />
        {:else}
          <div class="panel connect-panel">
            {#if state.error}
              <span class="connect-symbol"><Icon name="heart" /></span>
              <div class="panel-heading">
                <h2>菜单暂时没准备好。</h2>
                <p>重新加载试试，餐单会在连接成功后显示。</p>
              </div>
            {/if}
            <ErrorBox message={state.error} />
            <button
              type="button"
              data-action="load-menu"
              class="button primary"
              disabled={Boolean(state.busy)}
              onclick={() => controller.loadGiftMenu()}
            >
              {#if state.busy === 'menu'}
                <Spinner /><span role="status">正在前往麦当劳…</span>
              {:else}
                重新加载菜单 <Icon name="arrow" />
              {/if}
            </button>
          </div>
        {/if}
      </section>
      <!-- The mobile printer sticks to the viewport until the menu ends. -->
      <ReceiptPrinter amount={state.quote ? formatMoney(state.quote.amountCents) : '0'} openLabel="去结算">
        {#snippet action()}<SponsorshipButton {controller} dock />{/snippet}
        <MealReceipt {controller} />
      </ReceiptPrinter>
    </div>
  </main>
{/if}

<style>
  .gift-heading { display: block; }
  .gift-heading-copy { padding: 38px 0 32px; }
  .gift-heading h1 { margin: 0; font-size: clamp(28px, 3vw, 42px); line-height: 1.4; overflow-wrap: anywhere; }
  .gift-heading-copy > p { margin-top: 12px; font-size: 14px; }
  .gift-heading p a { display: inline; vertical-align: baseline; overflow-wrap: anywhere; }
  @media (max-width: 760px) {
    .gift-page { display: flex; flex-direction: column; }
    .gift-heading { flex-shrink: 0; }
    .gift-heading-copy { padding: 20px 0; }
    .gift-heading h1 { font-size: clamp(22px, 6vw, 28px); }
    .gift-heading-copy > p { font-size: 12px; }
    .gift-grid { display: flex; flex-direction: column; align-items: stretch; flex: 1; position: relative; border-bottom: 0; }
    .menu-area { flex: 1; }
  }
  @media (max-width: 760px) and (max-height: 480px) {
    .gift-heading-copy { padding: 12px 0; }
    .gift-heading h1 { font-size: 20px; }
    .gift-heading-copy > p { margin-top: 8px; }
  }
</style>

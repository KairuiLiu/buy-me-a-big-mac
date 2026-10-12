<script lang="ts">
  import { onMount } from 'svelte';
  import { createAppController } from './lib/controller.svelte';
  import AuthorPage from './components/AuthorPage.svelte';
  import GiftPage from './components/GiftPage.svelte';
  import PaymentResult from './components/PaymentResult.svelte';
  import IngredientCelebration from './components/IngredientCelebration.svelte';
  import Icon from './components/Icon.svelte';

  const controller = createAppController();
  const state = $derived(controller.state);
  const home = $derived(state.preview ? '#/preview/create' : '#create');
  onMount(() => controller.init());

  function goHome(event: MouseEvent) {
    event.preventDefault();
    controller.home();
  }
</script>

<a class="skip-link" href="#main" onclick={(event) => {
  event.preventDefault();
  const main = document.getElementById('main');
  if (main) { main.tabIndex = -1; main.focus(); }
}}>跳到主要内容</a>

<header class="header wrap">
  <a class="brand" href={home} onclick={goHome} data-action="home" aria-label="Buy me a Big Mac 首页">
    <img src="/assets/mark.svg" alt="" width="44" height="44" />
    <span>BUY ME A<br /><strong>BIG MAC<span class="brand-dot">.</span></strong></span>
  </a>
  <div class="header-caption">GOOD CODE.<br />GOOD FOOD.</div>
  <nav aria-label="主要导航">
    <a class:current={state.role === 'gift'} href="#/preview">菜单预览 <span>01</span></a>
    <a class:current={state.role === 'author'} href={home} onclick={goHome} data-action="home">创建赞助页 <span>02</span></a>
    <a class="nav-about" href="#how-it-works" data-action="how" onclick={(event) => { event.preventDefault(); controller.how(); }}>怎么玩 <Icon name="arrow" /></a>
  </nav>
</header>

{#if state.recentReceiptId && !state.preview}
  <div class="recent-receipt wrap">
    <a href={`#/thanks/${state.recentReceiptId}`}>最近的心意 · 查看付款通知 <Icon name="arrow" /></a>
  </div>
{/if}

{#if state.preview}
  <div class="preview-strip wrap">
    <span><i></i> 体验模式</span>
    <p>示例菜单与价格，尽情试选，不会产生付款。</p>
    <span class="mono">LOCAL EDITION / 001</span>
    <a href="#create">退出体验</a>
  </div>
{/if}

{#if state.role === 'author'}
  <AuthorPage {controller} />
{:else if state.role === 'payment'}
  <PaymentResult
    preview={state.preview}
    receipt={state.receipt}
    status={state.paymentStatus}
    busy={state.paymentBusy}
    error={state.paymentError}
    paymentUrl={controller.paymentUrl()}
    checkingUntil={state.receipt?.expiresAt}
    onCheck={() => void controller.checkPayment()}
    onContinue={() => controller.continuePayment()}
    onForget={() => controller.forgetPayment()}
  />
{:else}
  <GiftPage {controller} />
{/if}

<footer class="footer wrap">
  <strong>CODE. EAT. REPEAT.</strong>
  <span>为开源社区加餐。独立开发，非麦当劳官方产品。<br />餐品、价格与供应以官方渠道为准。</span>
  <a href="https://github.com/M-China/mcd-developer-innovation-challenge" target="_blank" rel="noopener noreferrer">麦当劳 MCP 创意开发大赛 <Icon name="external" /></a>
</footer>

<div id="toast" class="toast" class:visible={Boolean(controller.toastMessage)} role="status" aria-live="polite">{controller.toastMessage}</div>
<IngredientCelebration burst={state.celebrationId} />

<style>
  .recent-receipt { display: flex; justify-content: flex-end; margin-top: 12px; margin-bottom: 16px; }
  .recent-receipt a { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; text-decoration: underline; text-underline-offset: 4px; }
</style>

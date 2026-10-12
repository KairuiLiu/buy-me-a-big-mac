<script lang="ts">
  import { onMount } from 'svelte';
  import { createAppController } from './lib/controller.svelte';
  import AuthorPage from './components/AuthorPage.svelte';
  import GiftPage from './components/GiftPage.svelte';
  import PaymentResult from './components/PaymentResult.svelte';
  import IngredientCelebration from './components/IngredientCelebration.svelte';
  import Icon from './components/Icon.svelte';

  const controller = createAppController();
  const appState = $derived(controller.state);
  const home = $derived(appState.preview ? '#/preview/create' : '#create');
  const currentYear = new Date().getFullYear();
  let sharedGiftHref = $state('');
  onMount(() => controller.init());

  $effect(() => {
    if (appState.role === 'gift' && appState.config && !appState.badLink) {
      const hash = window.location.hash;
      if (/^#\/(?:preview\/)?gift\?/.test(hash)) sharedGiftHref = hash;
    }
  });

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
    <img src="/assets/mark.svg" alt="" width="48" height="48" />
    <span>BUY ME A<br /><strong>BIG MAC<span class="brand-dot">.</span></strong></span>
  </a>
  <nav aria-label="主要导航">
    {#if sharedGiftHref}
      <a class="nav-button" class:current={appState.role === 'gift'} aria-current={appState.role === 'gift' ? 'page' : undefined} href={sharedGiftHref}>发起赞助</a>
    {/if}
    <a class="nav-button" class:current={appState.role === 'author'} aria-current={appState.role === 'author' ? 'page' : undefined} href={home} onclick={goHome} data-action="home">创建我的赞助页</a>
    <a class="nav-button nav-github" href="https://github.com/KairuiLiu/buy-me-a-big-mac" target="_blank" rel="noopener noreferrer" aria-label="GitHub 项目（在新标签页打开）"><Icon name="github" /> GitHub</a>
  </nav>
</header>

{#if appState.preview}
  <div class="preview-strip wrap">
    <span><i></i> 体验模式</span>
    <p>示例菜单与价格，尽情试选，不会产生付款。</p>
    <span class="mono">LOCAL EDITION / 001</span>
    <a href="#create">退出体验</a>
  </div>
{/if}

{#if appState.role === 'author'}
  <AuthorPage {controller} />
{:else if appState.role === 'payment'}
  <PaymentResult
    preview={appState.preview}
    receipt={appState.receipt}
    status={appState.paymentStatus}
    busy={appState.paymentBusy}
    error={appState.paymentError}
    paymentUrl={controller.paymentUrl()}
    checkingUntil={appState.receipt?.expiresAt}
    onCheck={() => void controller.checkPayment()}
    onContinue={() => controller.continuePayment()}
    onReplay={() => controller.replayCelebration()}
  />
{:else}
  <GiftPage {controller} />
{/if}

<footer class="site-footer wrap">
  <p>© 2026{currentYear > 2026 ? ` – ${currentYear}` : ''} <span aria-hidden="true">🍔</span> Liu Kairui</p>
</footer>

<div id="toast" class="toast" class:visible={Boolean(controller.toastMessage)} role="status" aria-live="polite">{controller.toastMessage}</div>
<IngredientCelebration burst={appState.celebrationId} />

<style>
  .site-footer { margin-top: auto; padding: 28px 0 32px; border-top: 1px solid var(--ink); text-align: center; }
  .site-footer p { display: flex; align-items: center; justify-content: center; gap: 9px; color: var(--muted); font-size: 12px; letter-spacing: .01em; }
  .site-footer p span { font-size: 16px; }
</style>

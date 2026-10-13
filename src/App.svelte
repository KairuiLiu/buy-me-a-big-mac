<script lang="ts">
  import { onMount } from 'svelte';
  import { createAppController } from './lib/controller.svelte';
  import { createPath, matchRoute } from './lib/routes.js';
  import AuthorPage from './components/AuthorPage.svelte';
  import GiftPage from './components/GiftPage.svelte';
  import PaymentResult from './components/PaymentResult.svelte';
  import IngredientCelebration from './components/IngredientCelebration.svelte';
  import Icon from './components/Icon.svelte';

  const controller = createAppController();
  const appState = $derived(controller.state);
  const home = $derived(createPath(appState.preview));
  const currentYear = new Date().getFullYear();
  const footerCelebration = { pulseCount: 3, origin: 'bottom' } as const;
  let footerBurst = $state(0);
  let sharedGiftHref = $state('');
  onMount(() => controller.init());

  $effect(() => {
    if (appState.role === 'gift' && appState.config && !appState.badLink) {
      const { pathname, search } = window.location;
      // Any of the per-language gift paths counts: they are the same page.
      if (matchRoute(pathname).page === 'gift') sharedGiftHref = pathname + search;
    }
  });

  function goHome(event: MouseEvent) {
    event.preventDefault();
    controller.home();
  }

  // Keep same-site links in this tab. Handlers that already decided what to do,
  // in-page anchors and new-tab links are left alone.
  function route(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest('a');
    if (!link || link.target || link.hasAttribute('download') || link.origin !== window.location.origin) return;
    if (link.hash && link.pathname === window.location.pathname) return;
    event.preventDefault();
    controller.navigate(link.pathname + link.search);
  }
</script>

<svelte:window onclick={route} />

<a class="skip-link" href="#main" onclick={(event) => {
  event.preventDefault();
  const main = document.getElementById('main');
  if (main) { main.tabIndex = -1; main.focus(); }
}}>跳到主要内容</a>

<div class="page-shell">
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
      <a href="/">退出体验</a>
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
</div>

<footer class="site-footer" class:with-cart-bar={appState.role === 'gift' && !appState.badLink}>
  <p class="footer-lettuce">
    © 2026{currentYear > 2026 ? ` – ${currentYear}` : ''}
    <button class="footer-burger" type="button" onclick={() => footerBurst++} aria-label="播放三次食材礼花" title="来点食材礼花">
      <img src="/assets/badge-burger.svg" alt="" width="22" height="22" />
    </button>
    Liu Kairui
  </p>
  <div class="footer-patty" aria-hidden="true"></div>
  <div class="footer-middle-bun" aria-hidden="true"></div>
  <div class="footer-pickles" aria-hidden="true"></div>
  <div class="footer-patty" aria-hidden="true"></div>
  <div class="footer-cheese" aria-hidden="true"></div>
  <div class="footer-bottom-bun" aria-hidden="true"></div>
</footer>

<div id="toast" class="toast" class:visible={Boolean(controller.toastMessage)} role="status" aria-live="polite">{controller.toastMessage}</div>
<IngredientCelebration burst={appState.celebrationId} />
<IngredientCelebration burst={footerBurst} options={footerCelebration} />

<style>
  .page-shell { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
  .header, .preview-strip { flex-shrink: 0; }
  .site-footer { width: 100%; height: 40vh; height: 40dvh; min-height: 300px; flex-shrink: 0; display: grid; grid-template-rows: minmax(72px, 23fr) 14fr 18fr 8fr 14fr 5fr 18fr; }
  .footer-lettuce { display: flex; align-items: center; justify-content: center; gap: 9px; margin: 0; padding: 12px 20px; background: #a4b863; color: var(--ink); font-size: 12px; letter-spacing: .01em; }
  .footer-patty { background: #694330; }
  .footer-middle-bun { background: #e3b16b; }
  .footer-pickles { background: #769343; }
  .footer-cheese { background: #f4c542; }
  .footer-bottom-bun { background: #d99b52; }
  .footer-burger { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; transition: transform .18s ease, background .18s ease; }
  .footer-burger:hover { background: var(--yellow); transform: rotate(-8deg); }
  .footer-burger:active { transform: scale(.92); }
  .footer-burger:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
  @media (max-width: 760px) {
    .site-footer.with-cart-bar { grid-template-rows: minmax(72px, 23fr) 14fr 18fr 8fr 14fr 5fr minmax(80px, 18fr); }
  }
  @media (prefers-reduced-motion: reduce) { .footer-burger { transition: none; } .footer-burger:hover, .footer-burger:active { transform: none; } }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { createAppController } from './lib/controller.svelte';
  import { createPath, matchRoute } from './lib/routes.js';
  import AuthorPage from './components/AuthorPage.svelte';
  import GiftPage from './components/GiftPage.svelte';
  import PaymentResult from './components/PaymentResult.svelte';
  import IngredientCelebration from './components/IngredientCelebration.svelte';
  import type { CelebrationOptions } from './lib/ingredient-celebration/motion';
  import Icon from './components/Icon.svelte';

  const controller = createAppController();
  const appState = $derived(controller.state);
  const home = $derived(createPath(appState.preview));
  const currentYear = new Date().getFullYear();
  let footerCelebration = $state.raw<CelebrationOptions>({
    pulseCount: 3, particlesPerSide: 48, spreadDegrees: 165, speedScale: 1.35,
    pulseIntervalMs: 300, emissionDurationMs: 120,
  });
  let footerBurst = $state(0);
  let sharedGiftHref = $state('');
  let visibleHeight = $state<number>();
  let isIosSafari = $state(false);
  onMount(() => controller.init());

  onMount(() => {
    const userAgent = navigator.userAgent;
    const isIosPhone = /iPhone|iPod/.test(userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    // WebKit feature detection also matches other iOS browsers; this treatment needs Safari's toolbar.
    isIosSafari = isIosPhone && /Version\/\S+.*Mobile\/\S+ Safari\/[\d.]+$/.test(userAgent)
      && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Ddg\/|GSA\/|YaBrowser|UCBrowser|MicroMessenger|FBAN|FBAV|Instagram|Line\//i.test(userAgent)
      && !isStandalone;

    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      // The keyboard can shrink the visual viewport without changing dvh.
      // Leave the workspace size alone while the user is pinch-zooming.
      if (Math.abs(viewport.scale - 1) < 0.01) visibleHeight = viewport.height;
    };
    resize();
    viewport.addEventListener('resize', resize);
    return () => viewport.removeEventListener('resize', resize);
  });

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

  function celebrateFromBurger(event: MouseEvent) {
    const bounds = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
    footerCelebration = { ...footerCelebration, origin: {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    } };
    footerBurst++;
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

<div class="page-shell" class:author-shell={appState.role === 'author'} style:--visible-height={visibleHeight ? `${visibleHeight}px` : undefined}>
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
      provider={appState.paymentProvider}
      busy={appState.paymentBusy}
      error={appState.paymentError}
      paymentUrl={controller.paymentUrl()}
      checkingUntil={appState.receipt?.expiresAt}
      onCheck={() => void controller.checkPayment()}
      onContinue={() => controller.continuePayment()}
    />
  {:else}
    <GiftPage {controller} />
  {/if}
</div>

<footer class="site-footer" class:ios-safari={isIosSafari}>
  <p class="footer-lettuce">
    © 2026{currentYear > 2026 ? ` – ${currentYear}` : ''}
    <button class="footer-burger" type="button" onclick={celebrateFromBurger} aria-label="播放三次食材礼花" title="来点食材礼花">
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

{#if isIosSafari}
  <div class="ios-bottom-bun" aria-hidden="true"></div>
{/if}

<div id="toast" class="toast" class:visible={Boolean(controller.toastMessage)} role="status" aria-live="polite">{controller.toastMessage}</div>
<IngredientCelebration burst={appState.celebrationId} />
<IngredientCelebration burst={footerBurst} options={footerCelebration} append />

<style>
  .page-shell { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
  .header, .preview-strip { flex-shrink: 0; }
  .site-footer { width: 100%; height: 40vh; height: 40dvh; min-height: 300px; flex-shrink: 0; display: grid; grid-template-rows: 52px 22fr 24fr 2.5fr 22fr 6fr 25fr; }
  .footer-lettuce { display: flex; align-items: center; justify-content: center; gap: 9px; margin: 0; padding: 4px 20px; background: #4d5e3b; color: var(--paper); font-size: 12px; letter-spacing: .01em; }
  .footer-patty { background: #392820; }
  .footer-middle-bun { background: #795337; }
  .footer-pickles { background: #5a6d3d; }
  .footer-cheese { background: #9b742e; }
  .footer-bottom-bun { background: var(--bottom-bun); }
  .ios-bottom-bun { display: none; }
  @supports (-webkit-touch-callout: none) {
    /* Give iOS Safari a solid bottom edge to extend behind its toolbar. */
    .ios-bottom-bun { display: block; position: fixed; inset-inline: 0; bottom: 0; height: 12px; z-index: 13; background: var(--bottom-bun); pointer-events: none; }
    @media (max-width: 760px) {
      .site-footer.ios-safari {
        /* The toolbar completes the bun; remove its old share without stretching the other layers. */
        --full-footer-height: max(300px, 40dvh);
        --full-bun-height: calc((var(--full-footer-height) - 52px) * 25 / 101.5);
        height: calc(var(--full-footer-height) - var(--full-bun-height) + 24px);
        min-height: 0;
        grid-template-rows: 52px 22fr 24fr 2.5fr 22fr 6fr 24px;
      }
    }
  }
  .footer-burger { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; transition: transform .18s ease, background .18s ease; }
  .footer-burger:hover { background: #f5f1e71f; transform: rotate(-8deg); }
  .footer-burger:active { transform: scale(.92); }
  .footer-burger:focus-visible { outline: 2px solid var(--paper); outline-offset: 1px; }
  @media (max-width: 760px) {
    /* Extremely short keyboard/landscape views can scroll the page instead of clipping the form. */
    .page-shell.author-shell { height: 100svh; height: var(--visible-height, 100dvh); min-height: 360px; }
  }
  @media (prefers-reduced-motion: reduce) { .footer-burger { transition: none; } .footer-burger:hover, .footer-burger:active { transform: none; } }
</style>

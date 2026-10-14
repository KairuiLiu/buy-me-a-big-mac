<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { bindReceiptGestures } from '../lib/receipt-gestures.js';

  let {
    children, action, amount, openLabel = '查看小票', receiptId = 'printed-meal',
  }: {
    children: Snippet; action?: Snippet; amount: string;
    openLabel?: string; receiptId?: string;
  } = $props();
  let mobile = $state(false);
  let open = $state(false);
  let printing = $state(false);
  let retracting = $state(false);
  let reducedMotion = false;
  let toggleButton: HTMLButtonElement;
  let receiptWindow: HTMLDivElement;
  let sheet: HTMLDivElement;
  let machine: HTMLDivElement;
  let mouth: HTMLDivElement;
  let paperSpace = $state(0);
  let paperPull = $state(0);
  let previewReveal = $derived(Math.min(18, Math.max(0, -paperPull) / 4));
  let feed: Animation | undefined;
  let printRun = 0;

  function stopFeed() {
    printRun += 1;
    feed?.cancel();
    feed = undefined;
    printing = false;
    retracting = false;
  }

  function measureSpace() {
    // Use the actual outlet position, including the keyboard and the footer boundary.
    paperSpace = Math.max(0, machine.getBoundingClientRect().top - (window.visualViewport?.offsetTop || 0));
  }

  onMount(() => {
    const breakpoint = window.matchMedia('(max-width: 760px)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateBreakpoint = () => {
      const restoreDesktopFocus = mobile && !breakpoint.matches
        && machine.contains(document.activeElement);
      mobile = breakpoint.matches;
      if (!mobile) { open = false; paperPull = 0; stopFeed(); }
      if (restoreDesktopFocus) void tick().then(() => {
        if (mobile) return;
        const target = sheet.querySelector<HTMLElement>('[data-action="pay"]:not(:disabled)')
          || sheet.querySelector<HTMLElement>('.receipt-content > *');
        if (target) { if (target.tagName !== 'BUTTON') target.tabIndex = -1; target.focus({ preventScroll: true }); }
      });
      measureSpace();
      if (mobile && !open && receiptWindow.contains(document.activeElement)) {
        toggleButton.focus({ preventScroll: true });
      }
    };
    const updateMotion = () => {
      reducedMotion = motion.matches;
      if (reducedMotion && retracting) finishClosing();
      else if (reducedMotion && printing) finishPrinting();
    };
    updateMotion();
    updateBreakpoint();
    breakpoint.addEventListener('change', updateBreakpoint);
    motion.addEventListener('change', updateMotion);
    const observer = new ResizeObserver(entries => {
      measureSpace();
      // A rotation or cart edit can change the paper length mid-print.
      if (feed && entries.some(entry => entry.target === sheet)) {
        if (retracting) finishClosing();
        else finishPrinting();
      }
    });
    observer.observe(machine);
    observer.observe(sheet);
    const removeGestures = bindReceiptGestures({
      paper: receiptWindow, mouth,
      enabled: () => mobile,
      isOpen: () => open,
      isPrinting: () => printing || retracting,
      onPull: (distance: number) => { paperPull = distance; },
      onOpen: (distance: number) => { void showReceipt(distance); },
      onClose: closeReceipt,
    });
    window.addEventListener('scroll', measureSpace, { passive: true });
    window.visualViewport?.addEventListener('resize', measureSpace);
    window.visualViewport?.addEventListener('scroll', measureSpace);
    return () => {
      stopFeed();
      removeGestures();
      observer.disconnect();
      breakpoint.removeEventListener('change', updateBreakpoint);
      motion.removeEventListener('change', updateMotion);
      window.removeEventListener('scroll', measureSpace);
      window.visualViewport?.removeEventListener('resize', measureSpace);
      window.visualViewport?.removeEventListener('scroll', measureSpace);
    };
  });

  async function showReceipt(pull = 0) {
    stopFeed();
    paperPull = 0;
    const run = printRun;
    const viewport = window.visualViewport;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const bottom = machine.getBoundingClientRect().bottom;
    // At the menu's end the closed machine leaves with the page. Bring its
    // outlet back to the bottom before printing so the footer doesn't take
    // away the space needed for the paper.
    if (bottom < viewportBottom - 1) {
      window.scrollBy({ top: bottom - viewportBottom, behavior: 'instant' });
    }
    measureSpace();
    printing = !reducedMotion;
    open = true;
    await tick();
    if (!open || !mobile || run !== printRun) return;

    // Position the natural-length paper before transforming it. A transformed
    // sheet expands scrollHeight, so never use that value during the animation.
    const height = sheet.offsetHeight;
    const topSpace = sheet.offsetTop;
    receiptWindow.scrollTop = Math.max(0, topSpace + height - receiptWindow.clientHeight);
    if (!printing) return;

    // Continue from the paper already visible above the slot, including the
    // small length pulled out by hand, instead of restarting below the outlet.
    const revealed = Math.min(18, Math.max(0, -pull) / 4);
    const paperTop = receiptWindow.getBoundingClientRect().top + topSpace - receiptWindow.scrollTop;
    const start = Math.max(0, mouth.getBoundingClientRect().top - 8 - revealed - paperTop);
    const lines = Math.max(1, Math.ceil(start / 20));
    feed = sheet.animate([
      { transform: `translateY(${start}px)` },
      { transform: 'translateY(0)' },
    ], {
      duration: Math.min(5000, Math.max(1600, lines * 75)),
      easing: `steps(${lines}, end)`,
      fill: 'both',
    });
    feed.onfinish = finishPrinting;
  }

  function finishPrinting() {
    stopFeed();
    // A phone can rotate while feeding; finish with the complete lower edge out.
    receiptWindow.scrollTop = Math.max(0, sheet.offsetTop + sheet.offsetHeight - receiptWindow.clientHeight);
  }

  function closeReceipt() {
    if (!open || retracting) return;
    // Restore focus before the receipt becomes inert; this also dismisses an open keyboard.
    toggleButton.focus({ preventScroll: true });
    // Capture the visible position before cancelling a feed or a finger pull.
    const from = window.getComputedStyle(sheet).transform;
    const end = receiptWindow.scrollTop + receiptWindow.clientHeight - sheet.offsetTop - 20;
    stopFeed();
    paperPull = 0;
    if (reducedMotion || !mobile) { finishClosing(); return; }
    retracting = true;
    const run = printRun;
    feed = sheet.animate([
      { transform: from === 'none' ? 'translateY(0)' : from },
      { transform: `translateY(${end}px)` },
    ], { duration: 230, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'both' });
    feed.onfinish = () => { if (run === printRun) finishClosing(); };
  }

  function finishClosing() {
    stopFeed();
    paperPull = 0;
    open = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (mobile && open && event.key === 'Escape') {
      event.preventDefault();
      closeReceipt();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet paperEdge(id: string)}
  <svg class="paper-edge" aria-hidden="true" width="100%" height="8">
    <defs>
      <pattern {id} width="12" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 7 6 1 12 7V8H0Z" fill="var(--white)" />
        <path d="m0 7 6-6 6 6" fill="none" stroke="var(--ink)" stroke-width="1" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill={`url(#${id})`} />
  </svg>
{/snippet}

<div class="receipt-printer" class:is-open={open} class:is-printing={printing} class:is-retracting={retracting} style:--paper-space={`${paperSpace}px`} style:--paper-pull={`${Math.max(0, paperPull)}px`} style:--preview-reveal={`${previewReveal}px`}>
  <div
    class="receipt-window"
    id={receiptId}
    bind:this={receiptWindow}
    aria-hidden={mobile && (!open || printing || retracting) ? 'true' : undefined}
  >
    <div class="receipt-sheet" bind:this={sheet}>
      {@render paperEdge(`${receiptId}-edge`)}
      <div class="receipt-content" inert={mobile && (!open || printing || retracting)}>
        {@render children()}
      </div>
    </div>
  </div>

  <div class="printer-machine" bind:this={machine}>
    <div class="printer-mouth" bind:this={mouth} aria-hidden="true">
      <div class="paper-preview">{@render paperEdge(`${receiptId}-preview-edge`)}<i></i><i></i></div>
      <div class="printer-slot"></div>
    </div>
    <div class="printer-controls">
      <div class="printer-summary" aria-live="polite" aria-atomic="true">
        <strong><small>￥</small>{amount}</strong>
      </div>
      <div class="printer-actions">
        <button
          type="button"
          class="printer-button"
          class:collapse={Boolean(action && open)}
          data-action="view-cart"
          data-receipt-close={open ? '' : undefined}
          bind:this={toggleButton}
          aria-controls={receiptId}
          aria-expanded={open}
          aria-label={open ? '收起小票' : undefined}
          onclick={() => open ? closeReceipt() : showReceipt()}
        >
          {open ? '收起' : openLabel}
        </button>
        {#if open && action}{@render action()}{/if}
      </div>
    </div>
  </div>
</div>

<style>
  .receipt-printer, .receipt-window, .receipt-sheet, .receipt-content { display: contents; }
  .printer-machine { display: none; }
  .paper-edge { display: none; }

  @media (max-width: 760px) {
    .receipt-printer { --paper-feed: 12px; display: block; position: sticky; bottom: 0; z-index: 12; flex: 0 0 auto; min-width: 0; }
    /* Paper sits above the casing and rear slot, with only the front lip over it. */
    .receipt-window { display: block; position: absolute; z-index: 2; left: 12px; right: 12px; bottom: calc(100% - var(--paper-feed)); max-height: var(--paper-space); padding: 10px 4px 0; overflow-x: hidden; overflow-y: hidden; overflow-anchor: none; overscroll-behavior: none; touch-action: pinch-zoom; visibility: hidden; pointer-events: none; scrollbar-width: none; }
    .receipt-window::-webkit-scrollbar { display: none; }
    .receipt-sheet { display: flex; position: relative; flex-direction: column; background: var(--white); border: 1px solid var(--ink); border-top: 0; border-bottom: 0; transform: translateY(var(--paper-pull)); }
    .paper-edge { display: block; position: absolute; left: -1px; top: -7px; width: calc(100% + 2px); height: 8px; pointer-events: none; }
    .is-open .receipt-window { visibility: visible; pointer-events: auto; overflow-y: auto; }
    .is-printing .receipt-window, .is-retracting .receipt-window { overflow-y: hidden; }
    .receipt-content { display: block; flex: none; overflow: visible; }
    .printer-machine { display: block; position: relative; padding: 0 16px max(12px, env(safe-area-inset-bottom)); background: var(--ink); color: var(--paper); box-shadow: 0 -1px 0 #ffffff20 inset; }
    .printer-mouth { position: relative; height: 34px; touch-action: pinch-zoom; user-select: none; -webkit-user-select: none; }
    .printer-slot { position: absolute; z-index: 1; left: 0; right: 0; top: calc(var(--paper-feed) - 3px); height: 6px; border-radius: 4px; background: #11110f; }
    .printer-mouth::after { content: ''; position: absolute; z-index: 3; left: 0; right: 0; top: var(--paper-feed); height: 3px; border-radius: 0 0 4px 4px; background: #11110f; box-shadow: 0 1px 0 #ffffff26; pointer-events: none; }
    .paper-preview { position: absolute; z-index: 2; left: 0; right: 0; top: calc(-8px - var(--preview-reveal)); height: calc(20px + var(--preview-reveal)); padding: 6px 13px; background: var(--white); border-inline: 1px solid var(--ink); }
    .paper-preview i { display: block; height: 1px; margin-bottom: 4px; background: var(--line); }
    .paper-preview i:last-child { width: 65%; }
    .is-open .paper-preview { visibility: hidden; }
    .printer-controls { display: flex; position: relative; z-index: 3; align-items: center; justify-content: space-between; gap: 12px; }
    .printer-actions { display: flex; align-items: center; gap: 8px; }
    .printer-summary { min-width: 0; }
    .printer-summary strong { display: block; margin: 0; color: var(--paper); font: 24px/1 var(--mono); letter-spacing: -.06em; }
    .printer-summary small { margin-right: 3px; font-size: 13px; }
    .printer-button { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; gap: 12px; min-height: 46px; padding: 10px 14px; border: 1px solid var(--red); border-radius: 0; background: var(--red); color: var(--white); font: 600 13px var(--sans); }
    .printer-button.collapse { min-width: 48px; padding-inline: 8px; border-color: transparent; background: transparent; color: var(--paper); }
    .printer-button:focus-visible { outline: 2px solid var(--yellow); outline-offset: 3px; }
  }

</style>

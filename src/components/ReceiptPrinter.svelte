<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    children, amount, count, label = '我的餐单', heading = '您的小票',
    openLabel = '查看小票', showOpenArrow = true, closeLabel = '继续选餐', receiptId = 'printed-meal',
  }: {
    children: Snippet; amount: string; count: number; label?: string;
    heading?: string; openLabel?: string; showOpenArrow?: boolean; closeLabel?: string; receiptId?: string;
  } = $props();
  let mobile = $state(false);
  let open = $state(false);
  let printing = $state(false);
  let reducedMotion = false;
  let toggleButton: HTMLButtonElement;
  let closeButton: HTMLButtonElement;
  let receiptWindow: HTMLDivElement;

  onMount(() => {
    const breakpoint = window.matchMedia('(max-width: 760px)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateBreakpoint = () => {
      mobile = breakpoint.matches;
      if (!mobile) { open = false; printing = false; }
      if (mobile && !open && receiptWindow.contains(document.activeElement)) {
        toggleButton.focus({ preventScroll: true });
      }
    };
    const updateMotion = () => {
      reducedMotion = motion.matches;
      if (reducedMotion && printing) finishPrinting();
    };
    updateMotion();
    updateBreakpoint();
    breakpoint.addEventListener('change', updateBreakpoint);
    motion.addEventListener('change', updateMotion);
    return () => {
      breakpoint.removeEventListener('change', updateBreakpoint);
      motion.removeEventListener('change', updateMotion);
    };
  });

  async function showReceipt() {
    printing = !reducedMotion;
    open = true;
    if (!printing) await focusReceipt();
  }

  async function focusReceipt() {
    await tick();
    if (mobile && open && !printing && document.activeElement === toggleButton) {
      closeButton.focus({ preventScroll: true });
    }
  }

  function finishPrinting() {
    printing = false;
    void focusReceipt();
  }

  function closeReceipt() {
    // Restore focus before the receipt becomes inert; this also dismisses an open keyboard.
    toggleButton.focus({ preventScroll: true });
    open = false;
    printing = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (mobile && open && event.key === 'Escape') {
      event.preventDefault();
      closeReceipt();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="receipt-printer" class:is-open={open} class:is-printing={printing}>
  <div
    class="receipt-window"
    id={receiptId}
    bind:this={receiptWindow}
    inert={mobile && (!open || printing)}
    aria-hidden={mobile && (!open || printing) ? 'true' : undefined}
  >
    <div class="receipt-sheet" onanimationend={(event) => {
      if (event.target === event.currentTarget) finishPrinting();
    }}>
      <div class="receipt-tools">
        <span>{heading}</span>
        <button type="button" data-action="close-receipt" bind:this={closeButton} onclick={closeReceipt} aria-label={closeLabel === '收起小票' ? closeLabel : `收起小票，${closeLabel}`}>
          收起 <Icon name="chevron-down" />
        </button>
      </div>
      <div class="receipt-content">
        {@render children()}
      </div>
    </div>
  </div>

  <div class="printer-machine">
    <div class="printer-mouth" aria-hidden="true">
      <div class="paper-preview"><i></i><i></i></div>
      <div class="printer-slot"></div>
    </div>
    <div class="printer-controls">
      <div class="printer-summary" aria-live="polite" aria-atomic="true">
        <span class="printer-label"><i aria-hidden="true"></i>{label} <b>{count} 件</b></span>
        <strong><small>￥</small>{amount}</strong>
      </div>
      <button
        type="button"
        class="printer-button"
        data-action="view-cart"
        bind:this={toggleButton}
        aria-controls={receiptId}
        aria-expanded={open}
        aria-label={printing ? '停止出票并收起小票' : undefined}
        onclick={() => open ? closeReceipt() : showReceipt()}
      >
        {printing ? '出票中…' : open ? closeLabel : openLabel}
        {#if open}<Icon name="chevron-down" />{:else if showOpenArrow}<Icon name="arrow" />{/if}
      </button>
    </div>
  </div>
</div>

<style>
  .receipt-printer, .receipt-window, .receipt-sheet, .receipt-content { display: contents; }
  .printer-machine, .receipt-tools { display: none; }

  @media (max-width: 760px) {
    .receipt-printer { --paper-feed: 12px; display: block; position: sticky; bottom: 0; z-index: 12; flex: 0 0 auto; min-width: 0; }
    /* Paper sits above the casing and rear slot, with only the front lip over it. */
    .receipt-window { display: block; position: absolute; z-index: 2; left: 16px; right: 16px; bottom: calc(100% - var(--paper-feed)); overflow: hidden; visibility: hidden; pointer-events: none; transition: visibility 0s .25s; filter: drop-shadow(0 -6px 14px #25251e1f); }
    .receipt-sheet { display: flex; flex-direction: column; max-height: max(0px, min(65dvh, calc(var(--visible-height, 100dvh) - 150px))); background: var(--white); border: 1px solid var(--ink); border-bottom: 0; transform: translateY(calc(100% + 2px)); transition: transform .25s ease-in; }
    .is-open .receipt-window { visibility: visible; pointer-events: auto; transition-delay: 0s; }
    .is-open .receipt-sheet { transform: translateY(0); }
    .is-printing .receipt-sheet { animation: receipt-feed 1.7s linear both; transition: none; }
    .is-printing .receipt-window { pointer-events: none; }
    .receipt-tools { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; min-height: 44px; padding: 0 12px 0 20px; border-bottom: 1px dashed var(--line); }
    .receipt-tools > span { color: var(--muted); font: 11px var(--mono); letter-spacing: .06em; }
    .receipt-tools button { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 66px; min-height: 44px; padding: 0 6px; border: 0; color: var(--ink); background: transparent; font: 12px var(--sans); }
    .receipt-tools :global(svg) { width: 16px; height: 16px; }
    .receipt-content { display: block; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; scroll-padding: 16px; }
    .printer-machine { display: block; position: relative; padding: 0 16px max(12px, env(safe-area-inset-bottom)); background: var(--ink); color: var(--paper); box-shadow: 0 -1px 0 #ffffff20 inset; }
    .printer-mouth { position: relative; height: 22px; }
    .printer-slot { position: absolute; z-index: 1; left: 0; right: 0; top: calc(var(--paper-feed) - 3px); height: 6px; border-radius: 4px; background: #11110f; }
    .printer-mouth::after { content: ''; position: absolute; z-index: 3; left: 0; right: 0; top: var(--paper-feed); height: 3px; border-radius: 0 0 4px 4px; background: #11110f; box-shadow: 0 1px 0 #ffffff26; pointer-events: none; }
    .paper-preview { position: absolute; z-index: 2; left: 0; right: 0; bottom: 10px; height: 20px; padding: 6px 13px; background: var(--white); border: 1px solid var(--line); border-bottom: 0; transform-origin: bottom; transition: transform .24s, opacity .16s; }
    .paper-preview::before { content: ''; position: absolute; inset: -4px -1px auto; height: 4px; background: linear-gradient(135deg, transparent 50%, var(--white) 50%) 0 0 / 8px 8px, linear-gradient(225deg, transparent 50%, var(--white) 50%) 0 0 / 8px 8px; }
    .paper-preview i { display: block; height: 1px; margin-bottom: 4px; background: var(--line); }
    .paper-preview i:last-child { width: 65%; }
    .is-open .paper-preview { transform: scaleY(0); opacity: 0; }
    .printer-controls { display: flex; position: relative; z-index: 3; align-items: center; justify-content: space-between; gap: 12px; }
    .printer-summary { min-width: 0; }
    .printer-label { display: flex; align-items: center; gap: 6px; font-size: 10px; white-space: nowrap; }
    .printer-label > i { width: 5px; height: 5px; background: var(--yellow); border-radius: 50%; box-shadow: 0 0 0 3px #ffbc0d12; }
    .printer-label b { color: var(--yellow); font: 10px var(--mono); }
    .printer-summary strong { display: block; margin-top: 4px; color: var(--paper); font: 24px/1 var(--mono); letter-spacing: -.06em; }
    .printer-summary small { margin-right: 3px; font-size: 13px; }
    .printer-button { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; gap: 12px; min-height: 46px; padding: 10px 14px; border: 1px solid var(--red); border-radius: 0; background: var(--red); color: var(--white); font: 600 13px var(--sans); }
    .printer-button :global(svg) { width: 18px; height: 18px; }
    .printer-button:focus-visible { outline: 2px solid var(--yellow); outline-offset: 3px; }
    .receipt-tools button:focus-visible { outline: 2px solid var(--ink); outline-offset: -4px; }
  }

  @keyframes receipt-feed {
    0% { transform: translateY(calc(100% + 2px)); }
    10%, 16% { transform: translateY(86%); }
    32%, 39% { transform: translateY(62%); }
    55%, 62% { transform: translateY(38%); }
    80%, 87% { transform: translateY(14%); }
    100% { transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .receipt-window, .receipt-sheet, .paper-preview, .is-printing .receipt-sheet { transition: none; animation: none; }
  }
</style>

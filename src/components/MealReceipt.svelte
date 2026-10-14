<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppController } from '../lib/types';
  import { formatMoney } from '../lib/domain.js';
  import AuthorBarcode from './AuthorBarcode.svelte';
  import ErrorBox from './ErrorBox.svelte';
  import Icon from './Icon.svelte';
  import SponsorshipButton from './SponsorshipButton.svelte';

  let { controller }: { controller: AppController } = $props();
  let view = $derived(controller.state);
  let config = $derived(view.config);
  let count = $derived(view.cart.reduce((total, item) => total + item.quantity, 0));
  let ticket: HTMLElement;
  let ticketHeight = $state(0);
  onMount(() => {
    const observer = new ResizeObserver(() => { ticketHeight = ticket.getBoundingClientRect().height; });
    observer.observe(ticket);
    return () => observer.disconnect();
  });
</script>

<aside class="gift-aside" id="your-meal" aria-label="赞助小票" bind:this={ticket} style:top={`min(0px, calc(100dvh - ${ticketHeight}px))`}>
  <div class="sponsor-ticket">
    <div class="ticket-heading">
      <h2>一份心意<span>.</span></h2>
      <span class="ticket-stamp">{count} 件</span>
    </div>
    {#if config}
      <p class="ticket-project">{config.sponsorType === 'person' ? config.name : config.repo}</p>
    {/if}
    <div class="ticket-rule"></div>

    {#if view.cart.length}
      <div class="cart-lines">
        {#each view.cart as item (item.code)}
          <div class="cart-line">
            <span class="item-name">{item.name}</span>
            <div class="quantity-control">
              <button
                type="button"
                data-action="remove"
                data-code={item.code}
                aria-label={`减少${item.name}`}
                disabled={Boolean(view.busy)}
                onclick={() => controller.changeQuantity(item.code, -1)}
              ><Icon name="minus" /></button>
              <b>{item.quantity}</b>
              <button
                type="button"
                data-action="add"
                data-code={item.code}
                aria-label={`增加${item.name}`}
                disabled={item.quantity >= 20 || Boolean(view.busy)}
                onclick={() => controller.changeQuantity(item.code, 1)}
              ><Icon name="plus" /></button>
            </div>
          </div>
        {/each}
      </div>
      <div class="ticket-rule"></div>
    {:else}
      <p class="empty-cart">还没选餐，先挑几样喜欢的。</p>
    {/if}

    <div class="amount-row" aria-live="polite" aria-atomic="true">
      <span>金额</span>
      <strong><small>￥</small>{view.quote ? formatMoney(view.quote.amountCents) : '0'}</strong>
    </div>

    <div class="ticket-note">
      <label for="custom-blessing">留言</label>
      {#if config?.paymentProvider === 'stripe'}
        <p class="stripe-note" id="stripe-message-note">留在这张小票里, 不会通过 Stripe 发送给作者.</p>
      {/if}
      <div class="note-editor">
        <textarea
          id="custom-blessing"
          aria-describedby={config?.paymentProvider === 'stripe' ? 'stripe-message-note' : undefined}
          rows="4"
          value={view.customBlessing}
          disabled={Boolean(view.busy)}
          oninput={(event) => controller.setCustomBlessing(event.currentTarget.value)}
        ></textarea>
        <button
          type="button"
          class="note-cycle"
          aria-label="换一句感谢语"
          title="换一句感谢语"
          disabled={Boolean(view.busy)}
          onclick={() => controller.cycleBlessing()}
        ><Icon name="refresh" /></button>
      </div>
    </div>

    {#if view.menu}<ErrorBox message={view.error} />{/if}
    <div class="receipt-payment"><SponsorshipButton {controller} /></div>
    {#if config?.paymentProvider === 'stripe'}
      <p class="stripe-note">通过 Stripe 赞助, 建议金额可在付款页修改.</p>
    {/if}
    {#if view.paymentFallback}
      <button type="button" class="button outline full fallback" disabled={Boolean(view.busy)} onclick={() => controller.payDirect()}>
        仅前往爱发电 <Icon name="external" />
      </button>
      <p class="fallback-note">本次不查询付款通知，请在爱发电确认订单。</p>
    {/if}

    {#if config && config.paymentProvider !== 'stripe'}
      <div class="ticket-barcode"><AuthorBarcode afdianId={config.afdianId} /></div>
    {/if}
  </div>
</aside>

<style>
  .gift-aside { padding: 28px 22px 34px; min-width: 0; position: sticky; top: 0; }
  .sponsor-ticket { background: var(--white); padding: 25px; border: 1px solid var(--ink); position: relative; min-width: 0; box-shadow: 6px 6px 0 #25251e0a; }
  .sponsor-ticket::after { content: ''; position: absolute; bottom: -6px; height: 6px; left: -1px; right: -1px; background: linear-gradient(135deg, var(--ink) 25%, transparent 25%) -4px 0/8px 8px, linear-gradient(225deg, var(--ink) 25%, transparent 25%) -4px 0/8px 8px; }
  .ticket-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  h2 { margin: 0; font-size: 31px; letter-spacing: -.07em; font-weight: 800; }
  h2 > span { color: var(--red); }
  .ticket-stamp { font: 8px var(--mono); border: 1px solid var(--ink); background: var(--yellow); padding: 6px 7px; transform: rotate(-8deg); white-space: nowrap; }
  .ticket-project { font: 11px/1.7 var(--mono); margin: 0; overflow-wrap: anywhere; }
  .ticket-rule { border-top: 1px dashed var(--line); margin: 19px 0; }
  .cart-lines { display: grid; gap: 16px; }
  .empty-cart { color: var(--muted); font-size: 13px; line-height: 1.8; }
  .cart-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0; border: 0; }
  .item-name { font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
  .quantity-control { flex-shrink: 0; gap: 5px; }
  .quantity-control b { min-width: 12px; font: 12px var(--mono); }
  .quantity-control button { height: 28px; width: 26px; }
  .amount-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin: 23px 0; }
  .amount-row > span { font-size: 13px; }
  .amount-row strong { font: 34px var(--mono); letter-spacing: -.07em; }
  .amount-row small { font-size: 17px; margin-right: 4px; }
  .ticket-note { margin: 24px 0 20px; }
  .ticket-note label { display: block; margin-bottom: 10px; font-size: 13px; font-weight: 600; }
  .stripe-note { margin: 8px 0; font-size: 11px; line-height: 1.7; color: var(--muted); }
  .note-editor { position: relative; }
  textarea { display: block; width: 100%; min-height: 120px; padding: 12px 48px 12px 12px; border: 1px solid var(--line); border-radius: 0; background: var(--paper); color: var(--ink); font: 13px/1.8 var(--sans); resize: vertical; }
  textarea:focus-visible { outline: 2px solid var(--yellow); outline-offset: 2px; }
  .note-cycle { position: absolute; top: 1px; right: 1px; width: 36px; height: 36px; padding: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 0; background: var(--paper); color: var(--muted); transition: color .15s; }
  .note-cycle :global(svg) { width: 15px; height: 15px; }
  .note-cycle:hover:not(:disabled) { color: var(--ink); }
  .note-cycle:focus-visible { color: var(--ink); outline: 2px solid var(--ink); outline-offset: -4px; }
  .note-cycle:disabled { opacity: .45; }
  .button { min-height: 48px; }
  .fallback { margin-top: 10px; }
  .fallback-note { margin-top: 10px; color: var(--muted); font-size: 11px; line-height: 1.8; }
  .ticket-barcode { margin-top: 25px; }
  @media (min-width: 761px) and (max-width: 1100px) {
    .gift-aside { padding: 24px 14px; }
    .sponsor-ticket { padding: 20px; }
    h2 { font-size: 28px; }
  }
  @media (max-width: 760px) {
    .receipt-payment { display: none; }
    .gift-aside { position: static; padding: 0; }
    .sponsor-ticket { padding: 20px 20px 28px; border: 0; box-shadow: none; }
    .sponsor-ticket::after { display: none; }
    h2 { font-size: 28px; }
    .ticket-rule { margin: 16px 0; }
    .cart-lines { gap: 10px; }
    .amount-row { margin: 18px 0; }
    .ticket-note { margin: 18px 0; }
    textarea { font-size: 16px; min-height: 104px; }
    .quantity-control button { height: 40px; width: 36px; }
    .note-cycle { width: 42px; height: 42px; }
  }
  @media (prefers-reduced-motion: reduce) { .note-cycle { transition: none; } }
</style>

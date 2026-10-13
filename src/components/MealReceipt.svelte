<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppController } from '../lib/types';
  import { formatMoney } from '../lib/domain.js';
  import AuthorQr from './AuthorQr.svelte';
  import ErrorBox from './ErrorBox.svelte';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  let { controller }: { controller: AppController } = $props();
  let view = $derived(controller.state);
  let config = $derived(view.config);
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
      <span class="ticket-stamp" aria-hidden="true">FOR YOU</span>
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
    {/if}

    <div class="amount-row" aria-live="polite" aria-atomic="true">
      <span>金额</span>
      <strong><small>￥</small>{view.quote ? formatMoney(view.quote.amountCents) : '0'}</strong>
    </div>

    <div class="ticket-note">
      <label for="custom-blessing">留言</label>
      <textarea
        id="custom-blessing"
        rows="4"
        value={view.customBlessing}
        disabled={Boolean(view.busy)}
        oninput={(event) => controller.setCustomBlessing(event.currentTarget.value)}
      ></textarea>
    </div>

    {#if view.menu}<ErrorBox message={view.error} />{/if}
    <button
      type="button"
      class="button primary full"
      data-action="pay"
      disabled={!view.quote || !view.cart.length || Boolean(view.busy)}
      onclick={() => controller.pay()}
    >
      {view.busy === 'payment' ? '正在打开…' : '赞助'}
      {#if view.busy === 'payment'}<Spinner />{:else}<Icon name={view.preview ? 'arrow' : 'external'} />{/if}
    </button>
    {#if view.paymentFallback}
      <button type="button" class="button outline full fallback" disabled={Boolean(view.busy)} onclick={() => controller.payDirect()}>
        仅前往爱发电 <Icon name="external" />
      </button>
      <p class="fallback-note">本次不查询付款通知，请在爱发电确认订单。</p>
    {/if}

    {#if config}
      <div class="ticket-qr"><AuthorQr afdianId={config.afdianId} /></div>
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
  textarea { display: block; width: 100%; min-height: 120px; padding: 12px; border: 1px solid var(--line); border-radius: 0; background: var(--paper); color: var(--ink); font: 13px/1.8 var(--sans); resize: vertical; }
  textarea:focus-visible { outline: 2px solid var(--yellow); outline-offset: 2px; }
  .button { min-height: 48px; }
  .fallback { margin-top: 10px; }
  .fallback-note { margin-top: 10px; color: var(--muted); font-size: 11px; line-height: 1.8; }
  .ticket-qr { border-top: 1px dashed var(--line); margin-top: 25px; padding-top: 20px; }
  @media (min-width: 761px) and (max-width: 1100px) {
    .gift-aside { padding: 24px 14px; }
    .sponsor-ticket { padding: 20px; }
    h2 { font-size: 28px; }
  }
  @media (max-width: 760px) {
    .gift-aside { position: static; padding: 32px 12px 42px; }
    .sponsor-ticket { max-width: 440px; margin: auto; padding: 24px; }
    textarea { font-size: 16px; }
    .quantity-control button { height: 34px; width: 30px; }
  }
</style>

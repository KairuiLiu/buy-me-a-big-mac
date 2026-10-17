<script lang="ts">
  import type { AppController } from '../lib/types';
  import { formatMoney } from '../lib/domain.js';
  import AfdianIcon from './AfdianIcon.svelte';
  import StripeIcon from './StripeIcon.svelte';
  import ErrorBox from './ErrorBox.svelte';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';
  import ReceiptPrinter from './ReceiptPrinter.svelte';

  let { controller }: { controller: AppController } = $props();
  const state = $derived(controller.state);
</script>

<main id="main" class="wrap checkout-page">
  <section class="checkout-heading">
    <h1>选择支付方式</h1>
  </section>

  <div class="checkout-grid">
    <section class="payment-selection" aria-label="选择赞助渠道">
      <fieldset disabled={Boolean(state.busy)}>
        <legend>赞助渠道</legend>
        {#if state.config?.afdianId}
          <label class="payment-option" class:selected={state.checkoutProvider === 'afdian'}>
            <input type="radio" name="payment-method" value="afdian" checked={state.checkoutProvider === 'afdian'}
              onchange={() => controller.selectPaymentMethod('afdian')} />
            <span class="channel-icon"><AfdianIcon /></span>
            <span class="channel-name"><strong>爱发电</strong><small>支付宝 / 微信</small></span>
            <span class="selection-mark" aria-hidden="true"><Icon name="check" /></span>
          </label>
        {/if}
        {#if state.config?.stripePaymentLink}
          <label class="payment-option" class:selected={state.checkoutProvider === 'stripe'}>
            <input type="radio" name="payment-method" value="stripe" checked={state.checkoutProvider === 'stripe'}
              onchange={() => controller.selectPaymentMethod('stripe')} />
            <span class="channel-icon"><StripeIcon /></span>
            <span class="channel-name"><strong>Stripe</strong><small>Visa / 万事达 / 银联 / ApplePay</small></span>
            <span class="selection-mark" aria-hidden="true"><Icon name="check" /></span>
          </label>
        {/if}
      </fieldset>
      <ErrorBox message={state.error} />
      {#if state.paymentFallback && state.checkoutProvider === 'afdian'}
        <button type="button" class="button outline" disabled={Boolean(state.busy)} onclick={() => controller.payDirect()}>仅前往爱发电</button>
      {/if}
      <div class="checkout-actions">
        <button type="button" class="back-button" disabled={Boolean(state.busy)} onclick={() => controller.backToMenu()}>返回菜单</button>
        <button type="button" class="button primary" data-action="confirm-payment"
          disabled={!state.checkoutProvider || !state.quote || Boolean(state.busy)} onclick={() => void controller.pay()}>
          {#if state.busy === 'payment'}<Spinner /> 正在打开…{:else}下一步{/if}
        </button>
      </div>
    </section>

    <ReceiptPrinter amount={formatMoney(state.quote?.amountCents ?? 0)} receiptId="printed-checkout">
      <aside class="checkout-summary" aria-label="本次餐单">
        <div class="summary-heading"><h2>一份心意<span>.</span></h2><span class="item-count">{state.cart.reduce((sum, item) => sum + item.quantity, 0)} 件</span></div>
        <ul>
          {#each state.cart as item (item.code)}<li><span>{item.name}</span><b>× {item.quantity}</b></li>{/each}
        </ul>
        <div class="summary-amount"><span>金额</span><strong><small>￥</small>{formatMoney(state.quote?.amountCents ?? 0)}</strong></div>
        {#if state.customBlessing.trim()}<blockquote>{state.customBlessing.trim()}</blockquote>{/if}
      </aside>
    </ReceiptPrinter>
  </div>
</main>

<style>
  .checkout-page { flex: 1; padding-top: 38px; padding-bottom: 70px; }
  h1 { margin: 0; font-size: clamp(28px, 3vw, 42px); line-height: 1.4; }
  .checkout-heading { margin-bottom: 32px; }
  .checkout-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 370px); gap: 48px; align-items: start; }
  .payment-selection { min-width: 0; }
  fieldset { margin: 0 0 24px; padding: 0; border: 0; display: grid; gap: 14px; }
  legend { padding: 0 0 20px; font-size: 13px; font-weight: 600; }
  .payment-option { position: relative; display: flex; align-items: center; gap: 18px; min-height: 96px; padding: 22px; border: 1px solid var(--line); background: var(--white); cursor: pointer; }
  .payment-option.selected { border-color: var(--ink); background: var(--yellow); box-shadow: inset 0 0 0 1px var(--ink); }
  .payment-option:focus-within { outline: 2px solid var(--ink); outline-offset: 4px; }
  .payment-option input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  fieldset:disabled .payment-option { opacity: .65; cursor: default; }
  .channel-icon { display: grid; place-items: center; width: 38px; flex-shrink: 0; }
  .channel-icon :global(svg) { width: 30px; height: 30px; }
  .channel-name { display: grid; gap: 5px; flex: 1; min-width: 0; }
  .channel-name strong { font-size: 18px; }
  .channel-name small { font-size: 12px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
  .selected .channel-name small { color: var(--ink); }
  .selection-mark { width: 22px; height: 22px; flex-shrink: 0; display: grid; place-items: center; border: 1px solid var(--ink); border-radius: 50%; }
  .selection-mark :global(svg) { width: 14px; height: 14px; visibility: hidden; }
  .selected .selection-mark { color: var(--paper); background: var(--ink); }
  .selected .selection-mark :global(svg) { visibility: visible; }
  .checkout-actions { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 30px; }
  .checkout-actions .primary { min-width: 160px; min-height: 50px; }
  .back-button { background: none; border: 0; padding: 12px 0; font-size: 12px; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; }
  .checkout-summary { position: relative; padding: 26px; background: var(--white); border: 1px solid var(--ink); min-width: 0; }
  .checkout-summary::after { content: ''; position: absolute; bottom: -6px; height: 6px; left: -1px; right: -1px; background: linear-gradient(135deg, var(--ink) 25%, transparent 25%) -4px 0/8px 8px, linear-gradient(225deg, var(--ink) 25%, transparent 25%) -4px 0/8px 8px; }
  .summary-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  h2 { margin: 0; font-size: 28px; letter-spacing: -.06em; }
  h2 > span { color: var(--red); }
  .item-count { font-size: 10px; padding: 6px 8px; border: 1px solid var(--ink); background: var(--yellow); transform: rotate(-8deg); white-space: nowrap; }
  ul { list-style: none; padding: 22px 0; margin: 22px 0 0; border-block: 1px dashed var(--line); display: grid; gap: 16px; }
  li { display: flex; justify-content: space-between; gap: 14px; font-size: 12px; }
  li > span { overflow-wrap: anywhere; }
  li > b { white-space: nowrap; font: 11px var(--mono); }
  .summary-amount { display: flex; align-items: baseline; justify-content: space-between; margin-top: 24px; gap: 12px; }
  .summary-amount > span { font-size: 13px; }
  .summary-amount strong { font: 32px var(--mono); }
  .summary-amount small { font-size: 17px; }
  blockquote { margin: 24px 0 0; padding: 12px; border-left: 3px solid var(--yellow); background: var(--paper); font-size: 12px; line-height: 1.9; overflow-wrap: anywhere; white-space: pre-wrap; }
  @media (max-width: 760px) {
    .checkout-page { display: flex; flex-direction: column; padding-top: 24px; padding-bottom: 0; }
    .checkout-heading { margin-bottom: 24px; }
    .checkout-grid { display: flex; flex-direction: column; align-items: stretch; flex: 1; gap: 0; }
    .payment-selection { flex: 1; padding-bottom: 36px; }
    .payment-option { min-height: 84px; padding: 18px; }
    .checkout-actions .primary { min-width: 140px; }
    .checkout-summary { padding: 22px; border: 0; }
    .checkout-summary::after { display: none; }
  }
</style>

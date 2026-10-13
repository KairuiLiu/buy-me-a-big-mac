<script lang="ts">
  import type { AppController } from '../lib/types';
  import { hasPaymentNotifications, formatMoney } from '../lib/domain.js';
  import ErrorBox from './ErrorBox.svelte';
  import Icon from './Icon.svelte';
  import NotePrinter from './NotePrinter.svelte';
  import Spinner from './Spinner.svelte';

  let { controller }: { controller: AppController } = $props();
  let view = $derived(controller.state);
  let config = $derived(view.config);
  let count = $derived(view.cart.reduce((total, item) => total + item.quantity, 0));
  let calculating = $derived(view.quoteStatus === 'scheduled' || view.quoteStatus === 'loading');
  let payButton = $state<HTMLButtonElement>();
  let quoteTime = $derived(new Date(view.quotedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }));

  function revealPrintedNote(printer: HTMLElement) {
    if (!view.confirmed || !printer.isConnected || !payButton?.isConnected) return;

    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
    const visibleTop = viewportTop + 16;
    let visibleBottom = viewportBottom - 16;
    const cartBar = document.querySelector<HTMLElement>('.mobile-cart-bar')?.getBoundingClientRect();
    if (cartBar?.height && cartBar.top > viewportTop && cartBar.top < viewportBottom) {
      visibleBottom = Math.min(visibleBottom, cartBar.top - 12);
    }

    const start = printer.getBoundingClientRect().top;
    const end = payButton.getBoundingClientRect().bottom;
    const distance = end > visibleBottom
      ? end - visibleBottom
      : start < visibleTop ? start - visibleTop : 0;

    if (Math.abs(distance) > 1) {
      window.scrollBy({
        top: distance,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    }
  }
</script>

<aside class="gift-aside" id="your-meal">
  <div class="receipt gift-receipt">
    <div class="receipt-top"><span>YOUR LITTLE THANK-YOU</span><span>№ 001</span></div>
    <div class="receipt-title">
      <h2>你的餐单<span>.</span></h2>
      <span class="cart-count">{count} 件</span>
    </div>
    <p class="receipt-subtitle">一份好胃口，一句谢谢。</p>
    <div class="receipt-rule"></div>

    <div class="cart-lines">
      {#each view.cart as item (item.code)}
        <div class="cart-line">
          <div><strong>{item.name}</strong><small>一份好胃口，一句谢谢。</small></div>
          <div class="quantity-control">
            <button
              data-action="remove"
              data-code={item.code}
              aria-label={`减少${item.name}`}
              disabled={Boolean(view.busy)}
              onclick={() => controller.changeQuantity(item.code, -1)}
            ><Icon name="minus" /></button>
            <b>{item.quantity}</b>
            <button
              data-action="add"
              data-code={item.code}
              aria-label={`增加${item.name}`}
              disabled={item.quantity >= 20 || Boolean(view.busy)}
              onclick={() => controller.changeQuantity(item.code, 1)}
            ><Icon name="plus" /></button>
          </div>
        </div>
      {:else}
        <div class="empty-cart">
          <span class="empty-cart-symbol">＋</span>
          <p>还差一份，<br />让人开心的心意。</p>
          <small>选点好吃的，放进餐单吧。</small>
        </div>
      {/each}
    </div>

    <div class="receipt-rule"></div>
    <div class="amount-row" aria-live="polite" aria-atomic="true">
      <span>建议金额 <small>{count} 件餐品</small></span>
      <strong>
        {#if view.quote}
          <small>¥</small>{formatMoney(view.quote.amountCents)}
        {:else}
          <span class="amount-placeholder">{calculating ? '计算中' : view.quoteStatus === 'error' ? '待重试' : '待选餐'}</span>
        {/if}
      </strong>
    </div>

    {#if view.quote}
      <p class="quote-note">
        <Icon name="check" />
        {view.preview ? '示例金额已更新' : 'MCP 已更新'} · {quoteTime}
      </p>
    {:else}
      <p class="quote-note" aria-live="polite">
        {calculating ? '正在实时计算建议金额…' : view.quoteStatus === 'error' ? '金额暂时未能更新，请重试。' : '选餐后自动计算建议金额。'}
      </p>
    {/if}

    {#if view.menu}
      <ErrorBox message={view.error} />
    {/if}
    {#if view.quoteStatus === 'error'}
      <button
        class="button outline full"
        data-action="quote"
        disabled={!count || Boolean(view.busy)}
        onclick={() => controller.quote()}
      >重新计算 <Icon name="arrow" /></button>
    {/if}

    {#if view.confirmed}
      <div class="meal-confirmed success-label"><Icon name="check" /> 这一餐，选好了</div>
      <NotePrinter
        value={view.customBlessing}
        disabled={Boolean(view.busy)}
        onValueChange={(value) => controller.setCustomBlessing(value)}
        onPrinted={revealPrintedNote}
      />

      <button
        class="button primary full"
        data-action="pay"
        bind:this={payButton}
        disabled={!view.quote || !view.confirmed || calculating || Boolean(view.busy)}
        onclick={() => controller.pay()}
      >
        就这样！
        {#if view.busy === 'payment'}<Spinner />{:else}<Icon name={view.preview ? 'arrow' : 'external'} />{/if}
      </button>
      <p class="payment-note">
        {view.preview ? '演示体验 · 不会产生付款' : hasPaymentNotifications(config) ? '爱发电将在新标签页打开 · 付款后切回此页查看通知' : '爱发电将在新标签页打开 · 微信 / 支付宝付款'}
      </p>
      {#if view.paymentFallback}
        <button type="button" class="button outline full" disabled={Boolean(view.busy)} onclick={() => controller.payDirect()}>
          仅前往爱发电 <Icon name="external" />
        </button>
        <p class="payment-note">爱发电将在新标签页打开，本次不查询付款通知，请在爱发电确认订单。</p>
      {/if}
    {:else}
      <button
        class="button primary full"
        data-action="confirm-meal"
        disabled={!count || !view.quote || calculating || Boolean(view.busy)}
        onclick={() => controller.confirmMeal()}
      >选好了 <Icon name="check" /></button>
    {/if}
    {#if config}
      <div class="recipient">
        <span>{view.preview ? '演示赞助' : '收款作者'}</span>
        {#if view.preview}
          <span>{config.sponsorType === 'person' ? config.name : config.repo.split('/')[0]}</span>
        {:else}
          <code title={config.afdianId}>{config.afdianId.slice(0, 8)}…{config.afdianId.slice(-6)}</code>
        {/if}
      </div>
    {/if}
    <div class="barcode" aria-hidden="true"></div>
    <span class="receipt-bottom">GOOD CODE DESERVES GOOD FOOD.</span>
  </div>
  <p class="aside-note">
    {view.preview ? '菜单和金额仅为示例，用于预览操作流程。' : '这份心意通过爱发电送给作者。'}
    <br />作者自行安排用餐，这里不向餐厅下单。
  </p>
</aside>

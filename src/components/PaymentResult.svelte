<script lang="ts">
  import { createShareUrl, formatMoney, hasPaymentNotifications } from '../lib/domain.js';
  import { createPath } from '../lib/routes.js';
  import Icon from './Icon.svelte';
  import OrderBarcode from './OrderBarcode.svelte';
  import ReceiptPrinter from './ReceiptPrinter.svelte';
  import Spinner from './Spinner.svelte';

  let {
    receipt,
    status,
    provider = 'afdian',
    busy = false,
    error = '',
    paymentUrl = '',
    checkingUntil = 0,
    preview = false,
    onCheck,
    onContinue,
  }: {
    receipt: any | null;
    status: 'pending' | 'notified' | 'returned' | 'unknown' | 'error' | 'missing';
    provider?: 'afdian' | 'stripe';
    busy?: boolean; error?: string; paymentUrl?: string; checkingUntil?: number; preview?: boolean;
    onCheck: () => void; onContinue: () => void;
  } = $props();

  let now = $state(Date.now());
  const stripe = $derived(provider === 'stripe');
  const hasNotifications = $derived(!stripe && hasPaymentNotifications(receipt?.config) && !preview);
  const continueUntil = $derived(Number.isSafeInteger(receipt?.expiresAt) ? receipt.expiresAt : checkingUntil);
  const canContinue = $derived(!stripe && !preview && status === 'pending' && Boolean(paymentUrl) && continueUntil > now);
  const homeUrl = $derived(createPath(preview));
  const recipientName = $derived(receipt?.config?.sponsorType === 'person'
    ? receipt.config.name || '作者' : receipt?.config?.repo?.split('/')[0] || '作者');
  const orderNo = $derived(typeof receipt?.afdianOrderNo === 'string' ? receipt.afdianOrderNo.trim() : '');
  const authorId = $derived(typeof receipt?.config?.afdianId === 'string' ? receipt.config.afdianId : '');
  const waitingForOrder = $derived(hasNotifications && status === 'pending');

  $effect(() => {
    const deadline = continueUntil;
    if (status !== 'pending') return;
    now = Date.now();
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => { now = Date.now(); }, remaining + 1);
    return () => clearTimeout(timer);
  });

  const title = $derived(stripe ? '谢谢你的心意.' : status === 'notified' ? '心意已送达'
    : status === 'unknown' ? '这份心意，请到爱发电确认。'
    : status === 'missing' ? '还没有找到这张小票。'
    : status === 'error' ? (hasNotifications ? '稍等，再查一次。' : '这份心意，请到爱发电确认。') : '好代码，值得这一餐。');
  const subtitle = $derived(stripe
    ? (receipt ? `谢谢你, 让${recipientName}多了一份好胃口.`
      : '抱歉, 我们暂时没有收到这张小票, 付款可能需要一些时间')
    : status === 'notified' ? `已收到付款通知。谢谢你，让${recipientName}多了一份好胃口。`
    : status === 'missing' ? '本浏览器没有可用的赞助记录。你可以回到赞助链接继续选餐，或前往爱发电查看已有订单。'
    : !hasNotifications ? (preview ? '这是一张感谢小票预览。实际付款结果请以爱发电订单为准。' : '这张小票未开启付款通知。请前往爱发电查看订单，确认付款结果。')
    : status === 'unknown' ? '本站暂时无法确认付款结果。请查看爱发电订单，避免重复付款。'
    : status === 'error' ? '付款结果暂时未能查到。可以稍后重试，已支付的款项请以爱发电订单为准。'
    : '在爱发电完成付款后，回到这里，收好这张感谢小票。');

  const giftUrl = $derived.by(() => {
    try {
      if (!receipt?.config) return homeUrl;
      return createShareUrl(window.location.origin, receipt.config, { preview });
    } catch { return homeUrl; }
  });
  const amount = $derived.by(() => {
    try { return formatMoney(receipt?.amountCents ?? 0); }
    catch { return '—'; }
  });
  const receiptTime = $derived(receipt?.createdAt ? new Date(receipt.createdAt).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) : '—');
</script>

<main id="main" class="payment-result wrap">
  <section class="result-message" aria-labelledby="payment-result-title">
    <div class="result-mark" class:delivered={status === 'notified'} aria-hidden="true">
      <Icon name={status === 'notified' ? 'check' : 'heart'} />
    </div>
    <div class="status-copy" aria-live="polite" aria-atomic="true">
      <h1 id="payment-result-title">{title}</h1>
      <p>{subtitle}</p>
    </div>

    {#if error && hasNotifications}
      <p class="result-error" role="alert">{error}</p>
    {/if}

    <div class="result-actions">
      {#if hasNotifications && (status === 'pending' || status === 'error')}
        <button type="button" class="button primary" disabled={busy} onclick={onCheck}>
          {#if busy}<Spinner /> 查询中…{:else}{status === 'error' ? '重新查询付款结果' : '我已付款，查询结果'} <Icon name="arrow" />{/if}
        </button>
      {/if}
      {#if canContinue}
        <button type="button" class="button outline" disabled={busy} onclick={onContinue}>
          未完成付款，继续前往爱发电 <Icon name="external" />
        </button>
      {/if}
      {#if !stripe && ((!hasNotifications && !preview) || status === 'unknown' || status === 'missing' || status === 'error')}
        <a class="button outline" href="https://afdian.com/" target="_blank" rel="noopener noreferrer">去爱发电查看 <Icon name="external" /></a>
      {/if}
      {#if status === 'notified' || (stripe && receipt)}
        <a class="button primary" href={giftUrl}>回到赞助页面 <Icon name="arrow" /></a>
      {:else if stripe}
        <a class="button primary" href={homeUrl}>回到首页 <Icon name="arrow" /></a>
      {/if}
    </div>

    {#if hasNotifications && status === 'pending' && continueUntil <= now}
      <p class="result-help">等待窗口已结束，请先查询结果，或到爱发电查看已有订单。</p>
    {/if}

  </section>

  {#if receipt}
    <ReceiptPrinter {amount} receiptId="printed-order">
      <aside class="result-receipt" aria-label="本次赞助小票">
        <div class="ticket-heading"><h2>一份心意<span>.</span></h2><span class="ticket-stamp">FOR YOU</span></div>
        <p class="ticket-project">{receipt.config?.sponsorType === 'person' ? receipt.config.name : receipt.config?.repo || '致开源作者'}</p>
        <div class="ticket-rule"></div>
        <div class="ticket-items">
          {#each receipt.items || [] as item, index (`${item.code || 'item'}-${index}`)}
            <div><span>{item.name}</span><b>× {item.quantity}</b></div>
          {/each}
        </div>
        <div class="ticket-rule"></div>
        <div class="ticket-amount"><span>建议赞助金额</span><strong><small>¥</small>{amount}</strong></div>
        {#if receipt.blessing}<blockquote>“{receipt.blessing}”</blockquote>{/if}
        <dl class="ticket-details">
          <div><dt>{stripe ? '小票编号' : '订单号'}</dt><dd>{stripe ? receipt.intentId : orderNo || (waitingForOrder ? '等待付款通知' : '尚未获取')}</dd></div>
          <div><dt>赞助方式</dt><dd>{stripe ? 'Stripe' : '爱发电'}</dd></div>
          <div><dt>时间</dt><dd>{receiptTime}</dd></div>
        </dl>
        <div class="ticket-barcode">
          {#if stripe}
            <OrderBarcode value={receipt.intentId} label="小票编号" />
          {:else if orderNo || authorId}
            <OrderBarcode value={orderNo || authorId} label={orderNo ? '订单号' : '作者爱发电 ID'} />
          {/if}
        </div>
      </aside>
    </ReceiptPrinter>
  {/if}
</main>

<style>
  .payment-result { display: grid; grid-template-columns: minmax(0, 1fr) minmax(290px, 390px); align-items: start; gap: clamp(35px, 7vw, 104px); padding-top: 70px; padding-bottom: 100px; min-height: 70vh; }
  .result-message { padding-top: 9px; max-width: 560px; }
  .result-mark { display: flex; align-items: center; justify-content: center; width: 61px; height: 61px; border: 1px solid var(--ink); background: var(--yellow); margin: 0 0 22px; border-radius: 50%; transform: rotate(-8deg); }
  .result-mark :global(svg) { width: 30px; height: 30px; }
  .result-mark.delivered { color: var(--paper); background: var(--ink); }
  h1 { font-size: clamp(32px, 4vw, 52px); line-height: 1.22; letter-spacing: -.065em; margin: 0 0 20px; font-weight: 800; text-wrap: balance; }
  .status-copy > p { font-size: 14px; line-height: 1.9; color: var(--muted); max-width: 430px; margin: 0; }
  .result-actions { margin: 30px 0 18px; display: flex; flex-direction: column; align-items: stretch; gap: 11px; max-width: 340px; }
  .result-actions .button { min-height: 50px; }
  .result-help { color: var(--muted); font-size: 11px; line-height: 1.8; max-width: 390px; margin: 5px 0; }
  .result-error { padding: 12px 14px; margin: 22px 0 0; color: var(--red); font-size: 12px; line-height: 1.7; border-left: 2px solid var(--red); background: var(--white); }
  .result-receipt { background: var(--white); padding: 28px; border: 1px solid var(--ink); position: relative; min-width: 0; box-shadow: 6px 6px 0 #25251e0a; }
  .result-receipt::after { content: ''; position: absolute; bottom: -6px; height: 6px; left: -1px; right: -1px; background: linear-gradient(135deg, var(--ink) 25%, transparent 25%) -4px 0/8px 8px, linear-gradient(225deg, var(--ink) 25%, transparent 25%) -4px 0/8px 8px; }
  .ticket-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px; }
  h2 { margin: 0; font-size: 31px; letter-spacing: -.07em; font-weight: 800; }
  h2 > span { color: var(--red); }
  .ticket-stamp { font: 8px var(--mono); border: 1px solid var(--ink); background: var(--yellow); padding: 6px 7px; transform: rotate(-8deg); white-space: nowrap; }
  .ticket-project { font: 11px/1.7 var(--mono); margin: 0 0 24px; overflow-wrap: anywhere; }
  .ticket-rule { border-top: 1px dashed var(--line); margin: 19px 0; }
  .ticket-items { display: grid; gap: 16px; }
  .ticket-items > div { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; font-size: 13px; }
  .ticket-items > div > span { overflow-wrap: anywhere; }
  .ticket-items b { white-space: nowrap; font: 11px var(--mono); }
  .ticket-amount { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin: 23px 0; }
  .ticket-amount > span { font-size: 11px; }
  .ticket-amount strong { font: 34px var(--mono); letter-spacing: -.07em; }
  .ticket-amount small { font-size: 17px; margin-right: 4px; }
  blockquote { margin: 24px 0; border-left: 3px solid var(--yellow); padding: 12px 14px; background: var(--paper); font-size: 12px; line-height: 1.9; overflow-wrap: anywhere; white-space: pre-wrap; }
  .ticket-details { margin: 26px 0; }
  .ticket-details > div { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 13px; margin-top: 12px; font-size: 10px; line-height: 1.7; }
  dt { color: var(--muted); }
  dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
  .ticket-barcode { margin: 28px auto 15px; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; }
  @media (max-width: 760px) {
    .payment-result { display: flex; flex-direction: column; align-items: stretch; flex: 1; min-height: 0; padding-top: 0; padding-bottom: 0; gap: 0; }
    .result-message { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; width: 100%; max-width: none; padding: 32px 0 36px; text-align: center; }
    .result-mark { margin: 0 auto 22px; }
    .status-copy { width: 100%; }
    h1 { max-width: 430px; font-size: clamp(30px, 8vw, 36px); margin-inline: auto; }
    .status-copy > p { margin-inline: auto; text-wrap: balance; }
    .result-actions { width: 100%; max-width: 340px; margin: 24px 0 0; }
    .result-help { margin-top: 18px; }
    .result-receipt { width: 100%; padding: 20px; border: 0; box-shadow: none; }
    .result-receipt::after { display: none; }
  }
</style>

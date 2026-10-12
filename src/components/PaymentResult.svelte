<script lang="ts">
  import { createShareUrl, formatMoney } from '../lib/domain.js';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  let {
    receipt,
    status,
    busy = false,
    error = '',
    paymentUrl = '',
    checkingUntil = 0,
    preview = false,
    onCheck,
    onContinue,
    onForget,
  }: {
    receipt: any | null;
    status: 'pending' | 'notified' | 'unknown' | 'error' | 'missing';
    busy?: boolean; error?: string; paymentUrl?: string; checkingUntil?: number; preview?: boolean;
    onCheck: () => void; onContinue: () => void; onForget: () => void;
  } = $props();

  let now = $state(Date.now());
  const continueUntil = $derived(Number.isSafeInteger(receipt?.expiresAt) ? receipt.expiresAt : checkingUntil);
  const canContinue = $derived(!preview && status === 'pending' && Boolean(paymentUrl) && continueUntil > now);
  const homeUrl = $derived(preview ? '#/preview/create' : '#create');

  $effect(() => {
    const deadline = continueUntil;
    if (status !== 'pending') return;
    now = Date.now();
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => { now = Date.now(); }, remaining + 1);
    return () => clearTimeout(timer);
  });

  const title = $derived(status === 'notified' ? '心意已送达。'
    : status === 'unknown' ? '这份心意，请到爱发电确认。'
    : status === 'missing' ? '还没有找到这张小票。'
    : status === 'error' ? '稍等，再查一次。' : '好代码，值得这一餐。');
  const subtitle = $derived(status === 'notified' ? '已收到爱发电付款通知。谢谢你，让开源多了一份好胃口。'
    : status === 'unknown' ? '本站暂时无法确认付款结果。请查看爱发电订单，避免重复付款。'
    : status === 'missing' ? '本浏览器没有可用的赞助记录。你可以回到请客链接继续选餐，或前往爱发电查看已有订单。'
    : status === 'error' ? '付款结果暂时未能查到。可以稍后重试，已支付的款项请以爱发电订单为准。'
    : '在爱发电完成付款后，回到这里，收好这张感谢小票。');

  const giftUrl = $derived.by(() => {
    try {
      if (!receipt?.config) return homeUrl;
      const url = createShareUrl(window.location.origin, receipt.config);
      return preview ? url.replace('#/gift/', '#/preview/gift/') : url;
    } catch { return homeUrl; }
  });
  const expiryText = $derived(continueUntil > 0 ? new Date(continueUntil).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit',
  }) : '');
  const amount = $derived.by(() => {
    try { return formatMoney(receipt?.amountCents ?? 0); }
    catch { return '—'; }
  });
  const receiptTime = $derived(receipt?.createdAt ? new Date(receipt.createdAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '');
</script>

<main id="main" class="payment-result wrap">
  <section class="result-message" aria-labelledby="payment-result-title">
    <span class="eyebrow">GOOD CODE DESERVES GOOD FOOD</span>
    <div class="result-mark" class:delivered={status === 'notified'} aria-hidden="true">
      <Icon name={status === 'notified' ? 'check' : 'heart'} />
    </div>
    <div class="status-copy" aria-live="polite" aria-atomic="true">
      <h1 id="payment-result-title">{title}</h1>
      <p>{subtitle}</p>
    </div>

    {#if error}
      <p class="result-error" role="alert">{error}</p>
    {/if}

    <div class="result-actions">
      {#if status === 'pending' || status === 'error'}
        <button type="button" class="button primary" disabled={busy} onclick={onCheck}>
          {#if busy}<Spinner /> 查询中…{:else}{status === 'error' ? '重新查询付款结果' : '我已付款，查询结果'} <Icon name="arrow" />{/if}
        </button>
      {/if}
      {#if canContinue}
        <button type="button" class="button outline" disabled={busy} onclick={onContinue}>
          未完成付款，继续前往爱发电 <Icon name="external" />
        </button>
      {/if}
      {#if status === 'unknown' || status === 'missing' || status === 'error'}
        <a class="button outline" href="https://afdian.com/" target="_blank" rel="noopener noreferrer">去爱发电查看 <Icon name="external" /></a>
      {/if}
      {#if status === 'notified'}
        <a class="button primary" href={giftUrl}>回到项目餐厅 <Icon name="arrow" /></a>
      {/if}
    </div>

    {#if status === 'pending'}
      <p class="result-help">付款后，使用浏览器“返回”回到这里。已经付款请先查询结果，避免重复付款。</p>
      <p class="result-help">本次等待窗口为 5 分钟{expiryText ? `，至 ${expiryText}` : ''}。修改付款金额后，请以爱发电订单为准。</p>
      {#if continueUntil <= now}<p class="result-help">等待窗口已结束，请先查询结果，或到爱发电查看已有订单。</p>{/if}
    {:else if status === 'notified'}
      <p class="result-help">这份赞助由作者自行安排用餐，不会向餐厅下单。</p>
    {/if}

    <div class="result-links">
      <a href={homeUrl}>返回首页</a>
      {#if receipt}<button type="button" onclick={onForget}>清除本机小票</button>{/if}
    </div>
  </section>

  {#if receipt}
    <aside class="result-receipt" aria-label="本次赞助小票">
      <div class="receipt-top"><span>YOUR LITTLE THANK-YOU</span><span>{receiptTime}</span></div>
      <div class="ticket-heading"><h2>一份心意<span>.</span></h2><span class="ticket-stamp">{status === 'notified' ? 'THANK YOU' : 'FOR YOU'}</span></div>
      <p class="ticket-project">{receipt.config?.repo || '致开源作者'}</p>
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
        <div><dt>参考餐厅</dt><dd>{receipt.config?.storeName || '作者所选餐厅'}</dd></div>
        <div><dt>收款方式</dt><dd>爱发电 · 微信 / 支付宝</dd></div>
      </dl>
      <div class="barcode" aria-hidden="true"></div>
      <p class="ticket-foot">菜单表达请客心意，作者自行安排用餐。<br />付款金额与订单状态以爱发电为准。</p>
    </aside>
  {/if}
</main>

<style>
  .payment-result { display: grid; grid-template-columns: minmax(0, 1fr) minmax(290px, 390px); align-items: start; gap: clamp(35px, 7vw, 104px); padding-top: 70px; padding-bottom: 100px; min-height: 70vh; }
  .result-message { padding-top: 9px; max-width: 560px; }
  .result-mark { display: flex; align-items: center; justify-content: center; width: 61px; height: 61px; border: 1px solid var(--ink); background: var(--yellow); margin: 34px 0 22px; border-radius: 50%; transform: rotate(-8deg); }
  .result-mark :global(svg) { width: 30px; height: 30px; }
  .result-mark.delivered { color: var(--paper); background: var(--ink); }
  h1 { font-size: clamp(32px, 4vw, 52px); line-height: 1.22; letter-spacing: -.065em; margin: 0 0 20px; font-weight: 800; text-wrap: balance; }
  .status-copy > p { font-size: 14px; line-height: 1.9; color: var(--muted); max-width: 430px; margin: 0; }
  .result-actions { margin: 30px 0 18px; display: flex; flex-direction: column; align-items: stretch; gap: 11px; max-width: 340px; }
  .result-actions .button { min-height: 50px; }
  .result-help { color: var(--muted); font-size: 11px; line-height: 1.8; max-width: 390px; margin: 5px 0; }
  .result-links { display: flex; align-items: center; gap: 23px; margin-top: 29px; font-size: 11px; }
  .result-links a, .result-links button { color: var(--muted); text-decoration: underline; text-underline-offset: 4px; }
  .result-links button { border: 0; padding: 0; background: none; cursor: pointer; font-size: 11px; }
  .result-error { padding: 12px 14px; margin: 22px 0 0; color: var(--red); font-size: 12px; line-height: 1.7; border-left: 2px solid var(--red); background: var(--white); }
  .result-receipt { background: var(--white); padding: 28px; border: 1px solid var(--ink); position: relative; min-width: 0; box-shadow: 6px 6px 0 #25251e0a; }
  .result-receipt::after { content: ''; position: absolute; bottom: -6px; height: 6px; left: -1px; right: -1px; background: linear-gradient(135deg, var(--ink) 25%, transparent 25%) -4px 0/8px 8px, linear-gradient(225deg, var(--ink) 25%, transparent 25%) -4px 0/8px 8px; }
  .receipt-top { color: var(--muted); }
  .ticket-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 28px 0 12px; }
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
  .barcode { margin: 28px auto 15px; }
  .ticket-foot { margin: 0; text-align: center; color: var(--muted); font-size: 9px; line-height: 1.9; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; }
  @media (max-width: 760px) {
    .payment-result { grid-template-columns: 1fr; padding-top: 35px; padding-bottom: 64px; gap: 40px; }
    .result-message { max-width: 540px; }
    .result-mark { margin-top: 25px; }
    h1 { max-width: 430px; font-size: 36px; }
    .result-actions { max-width: none; }
    .result-receipt { max-width: 440px; width: 100%; justify-self: center; padding: 24px; }
  }
</style>

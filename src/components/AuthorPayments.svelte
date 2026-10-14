<script module lang="ts">
  export type PaymentSetupDraft = {
    afdianId: string; preview: boolean; enabled: boolean;
  };
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { createStripeReturnUrl } from '../lib/stripe.js';
  import type { PaymentProvider } from '../lib/types';
  import Icon from './Icon.svelte';

  let {
    afdianId,
    paymentProvider = 'afdian',
    preview = false,
    draft = $bindable<PaymentSetupDraft | null>(null),
    onChange,
  }: {
    afdianId: string;
    paymentProvider?: PaymentProvider;
    preview?: boolean;
    draft?: PaymentSetupDraft | null;
    onChange: (enabled: boolean) => void;
  } = $props();

  let enabled = $state(false);
  let copied = $state(false);
  let notice = $state('');
  let uid = $state('');
  let setupUrl = $state('');
  let copyAttempt = 0;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  const validId = $derived(/^[a-f0-9]{32}$/i.test(afdianId.trim()));

  function resetFeedback() {
    copyAttempt += 1;
    clearTimeout(copyTimer);
    copied = false;
    notice = '';
  }

  function syncSelection() {
    draft = { afdianId: uid, preview, enabled };
    onChange(enabled);
  }

  $effect(() => {
    const nextId = afdianId.trim().toLowerCase();
    const isPreview = preview;
    const provider = paymentProvider;
    untrack(() => {
      uid = nextId;
      enabled = draft?.afdianId === nextId && draft.preview === isPreview && draft.enabled;
      resetFeedback();
      if (provider === 'stripe') {
        try {
          setupUrl = isPreview ? 'https://example.invalid/thanks/stripe'
            : createStripeReturnUrl(window.location.origin);
        } catch {
          setupUrl = '';
          notice = '当前地址无法用于 Stripe 回跳, 请在正式 HTTPS 站点复制返回地址.';
        }
      } else {
        setupUrl = isPreview ? 'https://example.invalid/api/payments/webhook'
          : `${window.location.origin}/api/payments/webhook`;
      }
      if (provider === 'afdian') syncSelection();
    });
    return resetFeedback;
  });

  function toggle() {
    if (!preview && !validId) return;
    resetFeedback();
    enabled = !enabled;
    syncSelection();
  }

  async function copySetupUrl() {
    if (preview || !setupUrl || (paymentProvider === 'afdian' && !enabled)) return;
    const attempt = ++copyAttempt;
    notice = '';
    try {
      await navigator.clipboard.writeText(setupUrl);
      if (attempt !== copyAttempt) return;
      copied = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copied = false; }, 3000);
    } catch {
      if (attempt === copyAttempt) notice = '无法自动复制, 请在地址框中选中并手动复制.';
    }
  }
</script>

<section class="author-payments" aria-labelledby="payment-settings-title">
  {#if paymentProvider === 'stripe'}
    <div class="settings-heading">
      <div class="settings-title"><h3 id="payment-settings-title">付款后返回感谢小票</h3></div>
    </div>
    <div class="webhook-setup">
      <div class="webhook-copy">
        <input
          id="author-stripe-return-url"
          readonly
          value={setupUrl}
          aria-label={preview ? '演示用 Stripe 返回地址' : 'Stripe 付款后返回地址'}
          aria-describedby="stripe-return-instructions"
          autocomplete="off"
          spellcheck={false}
          onclick={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          class:success={copied}
          aria-label={copied ? '已复制' : '复制 Stripe 返回地址'}
          title={preview ? '演示地址不可用于实际配置' : '复制 Stripe 返回地址'}
          disabled={preview || !setupUrl}
          onclick={() => void copySetupUrl()}
        >
          <span class="button-content" aria-hidden="true"><Icon name="copy" /></span>
          <span class="success-mark" aria-hidden="true"><Icon name="check" /></span>
        </button>
      </div>
      {#if preview}<p class="setup-instructions">演示地址不可用于实际配置, 请在正式站点复制返回地址.</p>{/if}
      <p class="setup-instructions" id="stripe-return-instructions">在 <a href="https://dashboard.stripe.com/payment-links" target="_blank" rel="noopener noreferrer">Stripe Payment Link</a> 的 After the payment 中选择跳转到网站, 粘贴此地址并保存.</p>
      <p class="setup-instructions">可在 Stripe 添加名为 "留言" 的可选文本字段, 支持者在付款页填写.</p>
      <p class="setup-instructions">本站填写的留言仅保存在赞助者本机的感谢小票中, 不会自动发送给您.</p>
    </div>
  {:else}
  <div class="settings-heading">
    <div class="settings-title">
      <h3 id="payment-settings-title">付款后送上一张感谢小票</h3>
      <span class="optional-label">可选</span>
    </div>
    <button
      class="settings-toggle"
      type="button"
      role="switch"
      aria-labelledby="payment-settings-title"
      aria-checked={enabled}
      title={!preview && !validId ? '先填写上方的 32 位爱发电用户 ID' : '设置可选的付款通知'}
      disabled={!preview && !validId}
      onclick={toggle}
    >
      <span class="switch-track" class:enabled aria-hidden="true"><span></span></span>
    </button>
  </div>

  {#if enabled}
    <div class="webhook-setup">
      <p class="setup-instructions">所有作者、所有项目共用这个通知地址，只需在爱发电设置一次。</p>
      <div class="webhook-copy">
        <input
          id="author-webhook-url"
          readonly
          value={setupUrl}
          aria-label={preview ? '演示用 Webhook 示例地址' : '通用 Webhook 地址'}
          aria-describedby="webhook-instructions"
          autocomplete="off"
          spellcheck={false}
          onclick={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          class:success={copied}
          aria-label={copied ? '已复制' : '复制通用 Webhook 地址'}
          title={preview ? '演示地址不可用于实际配置' : '复制通用 Webhook 地址'}
          disabled={preview}
          onclick={() => void copySetupUrl()}
        >
          <span class="button-content" aria-hidden="true"><Icon name="copy" /></span>
          <span class="success-mark" aria-hidden="true"><Icon name="check" /></span>
        </button>
      </div>
      <p class="setup-instructions" id="webhook-instructions">在 <a href="https://afdian.com/dashboard/dev" target="_blank" rel="noopener noreferrer">爱发电开发者后台</a> Webhook URL 处粘贴地址并保存</p>
    </div>
  {/if}
  {/if}

  <span class="sr-only" role="status">{copied ? '已复制' : ''}</span>
  {#if notice}<p class="settings-feedback" role="status">{notice}</p>{/if}
</section>

<style>
  .author-payments { margin: 0; padding: 0; }
  .settings-heading { display: flex; align-items: center; gap: 12px; justify-content: space-between; min-height: 24px; }
  .settings-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
  h3 { margin: 0; color: var(--ink); font-size: 12px; font-weight: 600; line-height: 1.5; letter-spacing: normal; }
  .optional-label { border: 1px solid var(--line); padding: 2px 5px; flex-shrink: 0; color: var(--muted); font-size: 9px; line-height: 1.3; }
  .settings-toggle { padding: 1px 0 1px 6px; margin: 0; background: none; border: 0; color: var(--ink); display: inline-flex; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0; }
  .settings-toggle:disabled { cursor: default; opacity: .5; }
  .switch-track { display: inline-flex; align-items: center; width: 36px; height: 21px; padding: 3px; border: 1px solid var(--ink); border-radius: 20px; background: var(--paper); flex-shrink: 0; }
  .switch-track > span { width: 13px; height: 13px; background: var(--ink); border-radius: 50%; transition: transform .15s; }
  .switch-track.enabled { background: var(--yellow); }
  .switch-track.enabled > span { transform: translateX(15px); }
  .webhook-setup { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 13px; min-width: 0; }
  .setup-instructions { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
  .setup-instructions a { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
  .webhook-copy { display: flex; flex: 1; border: 1px solid var(--line); background: var(--white); min-width: 0; }
  .webhook-copy input { flex: 1; width: 0; min-width: 0; min-height: 42px; border: 0; border-radius: 0; padding: 11px 10px; font: 10px var(--mono); color: var(--ink); background: transparent; }
  .webhook-copy button { display: grid; place-items: center; flex-shrink: 0; width: 42px; padding: 10px; border: 0; border-left: 1px solid var(--line); border-radius: 0; background: var(--paper); cursor: pointer; color: var(--ink); }
  .webhook-copy button:disabled { opacity: .5; cursor: default; }
  .webhook-copy button :global(svg) { width: 15px; height: 15px; }
  .button-content, .success-mark { grid-area: 1 / 1; display: inline-flex; align-items: center; justify-content: center; transition: opacity .2s ease; }
  .success-mark { opacity: 0; color: var(--green); }
  .success .button-content { opacity: 0; }
  .success .success-mark { opacity: 1; }
  .settings-feedback { margin: 9px 0 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
  @media (max-width: 760px) { .webhook-copy input { font-size: 16px; } }
  @media (max-width: 580px) { h3 { font-size: 11px; } .settings-heading { gap: 8px; } .settings-title { gap: 6px; } }
  @media (prefers-reduced-motion: reduce) { .switch-track > span, .button-content, .success-mark { transition: none; } }
</style>

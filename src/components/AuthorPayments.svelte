<script module lang="ts">
  type Integration = {
    afdianId?: string; integrationId: string; webhookUrl: string;
    managementToken: string; enabled: boolean; updatedAt?: number;
  };

  export type PaymentSetupDraft = {
    afdianId: string; preview: boolean; enabled: boolean; integration: Integration | null;
  };
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { PaymentsClient } from '../lib/payments.js';
  import { readIntegration, saveIntegration } from '../lib/payment-storage.js';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  let {
    afdianId,
    preview = false,
    draft = $bindable<PaymentSetupDraft | null>(null),
    onChange,
    onBusyChange,
  }: {
    afdianId: string;
    preview?: boolean;
    draft?: PaymentSetupDraft | null;
    onChange: (integrationId?: string) => void;
    onBusyChange?: (busy: boolean) => void;
  } = $props();

  let integration = $state<Integration | null>(null);
  let enabled = $state(false);
  let busy = $state('');
  let error = $state('');
  let notice = $state('');
  let storageNotice = $state('');
  let diagnostic = $state<boolean | null>(null);
  let uid = $state('');
  let client: PaymentsClient | null = null;
  let generation = 0;
  let copyAttempt = 0;
  const success = $state({ copy: false, test: false });
  const successTimers: Partial<Record<keyof typeof success, ReturnType<typeof setTimeout>>> = {};
  const validId = $derived(/^[a-f0-9]{32}$/i.test(afdianId.trim()));

  function clearSuccess(action: keyof typeof success) {
    clearTimeout(successTimers[action]);
    delete successTimers[action];
    success[action] = false;
  }

  function showSuccess(action: keyof typeof success) {
    clearSuccess(action);
    success[action] = true;
    successTimers[action] = setTimeout(() => clearSuccess(action), 3000);
  }

  function resetFeedback() {
    copyAttempt += 1;
    clearSuccess('copy');
    clearSuccess('test');
    error = '';
    notice = '';
    diagnostic = null;
  }

  function syncSelection() {
    draft = { afdianId: uid, preview, enabled, integration };
    onChange(enabled ? (preview ? '0'.repeat(32) : integration?.integrationId) : undefined);
  }

  $effect(() => {
    onBusyChange?.(Boolean(busy));
  });

  $effect(() => {
    const nextId = afdianId.trim().toLowerCase();
    const isPreview = preview;
    const nextClient = isPreview ? null : new PaymentsClient();
    untrack(() => {
      generation += 1;
      uid = nextId;
      integration = null;
      enabled = false;
      busy = '';
      resetFeedback();
      storageNotice = '';
      client = nextClient;
      // Only an explicit choice in this flow may restore the switch.
      // Saved credentials can be reused without opting the author in.
      if (draft?.afdianId === nextId && draft.preview === isPreview) {
        integration = draft.integration;
        enabled = draft.enabled && (isPreview || Boolean(integration));
      } else if (!isPreview && /^[a-f0-9]{32}$/.test(nextId)) {
        integration = readIntegration(nextId);
      }
      syncSelection();
    });
    return () => {
      generation += 1;
      resetFeedback();
      nextClient?.disconnect();
      if (client === nextClient) client = null;
    };
  });

  function persist(value: Integration) {
    const saved = saveIntegration(uid, value);
    storageNotice = saved ? '' : '浏览器未能保存配置。请先复制下面的私密地址；离开后可能需要重新设置。';
  }

  async function toggle() {
    if (busy) return;
    if (!preview && (!validId || !client)) return;
    generation += 1;
    resetFeedback();
    if (preview) {
      enabled = !enabled;
      syncSelection();
      return;
    }
    if (enabled) {
      enabled = false;
      if (integration) {
        integration = { ...integration, enabled: false };
        persist(integration);
      }
      syncSelection();
      return;
    }
    if (integration) {
      integration = { ...integration, enabled: true };
      enabled = true;
      persist(integration);
      syncSelection();
      return;
    }
    const attempt = generation;
    busy = 'register';
    try {
      const registration = await client!.register(uid);
      if (attempt !== generation) return;
      integration = { ...registration, enabled: true };
      enabled = true;
      persist(integration);
      syncSelection();
    } catch (cause) {
      if (attempt !== generation) return;
      error = cause instanceof Error ? cause.message : '暂时无法开启付款通知，请重试。';
    } finally {
      if (attempt === generation) busy = '';
    }
  }

  async function copyWebhook() {
    if (preview || !enabled || !integration) return;
    const attempt = generation;
    const copy = ++copyAttempt;
    notice = '';
    try {
      await navigator.clipboard.writeText(integration.webhookUrl);
      if (attempt === generation && copy === copyAttempt) showSuccess('copy');
    } catch {
      if (attempt === generation && copy === copyAttempt) {
        clearSuccess('copy');
        notice = '无法自动复制，请在地址框中选中并手动复制。';
      }
    }
  }

  async function checkConnection() {
    if (preview || !enabled || !integration || !client || busy) return;
    const attempt = generation;
    busy = 'check';
    error = '';
    diagnostic = null;
    clearSuccess('test');
    try {
      const result = await client.integrationStatus(integration.integrationId, integration.managementToken);
      if (attempt === generation) {
        diagnostic = result.webhookReceived;
        if (diagnostic) showSuccess('test');
      }
    } catch (cause) {
      if (attempt === generation) error = cause instanceof Error ? cause.message : '暂时无法查询通知，请稍后再试。';
    } finally {
      if (attempt === generation) busy = '';
    }
  }
</script>

<section class="author-payments" aria-labelledby="payment-settings-title">
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
      aria-busy={busy === 'register'}
      title={!preview && !validId ? '先填写上方的 32 位爱发电用户 ID' : preview ? '演示：展开示例设置，不会创建真实付款通知' : '设置可选的付款通知'}
      disabled={(!preview && !validId) || Boolean(busy)}
      onclick={() => void toggle()}
    >
      {#if busy === 'register'}<Spinner />{/if}
      <span class="switch-track" class:enabled aria-hidden="true"><span></span></span>
    </button>
  </div>

  {#if enabled && (preview || integration)}
    <div class="webhook-setup">
      <div class="webhook-copy">
        <input
          id="author-webhook-url"
          readonly
          value={preview ? 'https://example.invalid/webhooks/afdian/demo' : integration?.webhookUrl || ''}
          aria-label={preview ? '演示用 Webhook 示例地址' : '私密 Webhook 地址'}
          aria-describedby="webhook-instructions"
          title={preview ? '演示地址，不可用于真实付款通知' : '私密地址仅填写在爱发电后台，请勿公开或放进 README'}
          autocomplete="off"
          spellcheck={false}
          onclick={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          class:success={success.copy}
          aria-label={success.copy ? '已复制' : '复制私密 Webhook 地址'}
          title={preview ? '演示地址不可用于实际配置' : '复制私密 Webhook 地址'}
          disabled={preview}
          onclick={() => void copyWebhook()}
        >
          <span class="button-content" aria-hidden="true"><Icon name="copy" /></span>
          <span class="success-mark" aria-hidden="true"><Icon name="check" /></span>
        </button>
        <button
          class="check-button"
          class:success={success.test}
          type="button"
          aria-label={success.test ? '测试成功' : '测试'}
          aria-busy={busy === 'check'}
          disabled={preview || Boolean(busy)}
          title={preview ? '演示模式不执行测试，也不会请求爱发电服务' : '检查是否收到爱发电后台发送的测试通知'}
          onclick={() => void checkConnection()}
        >
          <span class="button-content" aria-hidden="true">{#if busy === 'check'}<Spinner />{:else}测试{/if}</span>
          <span class="success-mark" aria-hidden="true"><Icon name="check" /></span>
        </button>
      </div>
      <p class="setup-instructions" id="webhook-instructions">在 <a href="https://afdian.com/dashboard/dev" target="_blank" rel="noopener noreferrer">爱发电开发者后台</a> 粘贴上方地址并保存, 然后点击上方测试按钮验证</p>
    </div>
  {/if}

  <span class="sr-only" role="status">{[success.copy ? '已复制' : '', success.test ? '测试成功' : ''].filter(Boolean).join('，')}</span>
  {#if enabled && diagnostic === false}
    <p class="settings-feedback" role="status">还未收到通知，请先在爱发电后台发送测试。</p>
  {/if}
  {#if storageNotice}<p class="settings-feedback warning" role="status">{storageNotice}</p>{/if}
  {#if notice}<p class="settings-feedback" role="status">{notice}</p>{/if}
  {#if error}<p class="settings-feedback error" role="alert">{error}</p>{/if}
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
  .webhook-copy .check-button { width: 48px; font-size: 11px; white-space: nowrap; }
  .webhook-copy button:disabled { opacity: .5; cursor: default; }
  .webhook-copy { display: flex; flex: 1; border: 1px solid var(--line); background: var(--white); min-width: 0; }
  .webhook-copy input { flex: 1; width: 0; min-width: 0; min-height: 42px; border: 0; border-radius: 0; padding: 11px 10px; font: 10px var(--mono); color: var(--ink); background: transparent; }
  .webhook-copy button { display: grid; place-items: center; flex-shrink: 0; width: 42px; padding: 10px; border: 0; border-left: 1px solid var(--line); border-radius: 0; background: var(--paper); cursor: pointer; color: var(--ink); }
  .webhook-copy button :global(svg) { width: 15px; height: 15px; }
  .button-content, .success-mark { grid-area: 1 / 1; display: inline-flex; align-items: center; justify-content: center; transition: opacity .2s ease; }
  .success-mark { opacity: 0; color: var(--green); }
  .success .button-content { opacity: 0; }
  .success .success-mark { opacity: 1; }
  .settings-feedback { margin: 9px 0 0; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
  .settings-feedback.error { color: var(--red); }
  .settings-feedback.warning { color: var(--ink); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
  @media (max-width: 580px) {
    h3 { font-size: 11px; }
    .settings-heading { gap: 8px; }
    .settings-title { gap: 6px; }
  }
  @media (prefers-reduced-motion: reduce) { .switch-track > span, .button-content, .success-mark { transition: none; } }
</style>

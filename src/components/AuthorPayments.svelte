<script lang="ts">
  import { untrack } from 'svelte';
  import { PaymentsClient } from '../lib/payments.js';
  import { readIntegration, saveIntegration } from '../lib/payment-storage.js';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  let {
    afdianId,
    preview = false,
    onChange,
  }: { afdianId: string; preview?: boolean; onChange: (integrationId?: string) => void } = $props();

  type Integration = {
    afdianId?: string; integrationId: string; webhookUrl: string;
    managementToken: string; enabled: boolean; updatedAt?: number;
  };

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
  const validId = $derived(/^[a-f0-9]{32}$/i.test(afdianId.trim()));

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
      error = '';
      notice = '';
      storageNotice = '';
      diagnostic = null;
      client = nextClient;
      if (!isPreview && /^[a-f0-9]{32}$/.test(nextId)) {
        integration = readIntegration(nextId);
        enabled = integration?.enabled === true;
      }
      onChange(enabled ? integration?.integrationId : undefined);
    });
    return () => {
      generation += 1;
      nextClient?.disconnect();
      if (client === nextClient) client = null;
    };
  });

  function persist(value: Integration) {
    const saved = saveIntegration(uid, value);
    storageNotice = saved ? '' : '浏览器未能保存配置。请先复制下面的私密地址；离开后可能需要重新设置。';
  }

  async function toggle() {
    if (preview || !validId || busy || !client) return;
    error = '';
    notice = '';
    if (enabled) {
      enabled = false;
      if (integration) {
        integration = { ...integration, enabled: false };
        persist(integration);
      }
      onChange(undefined);
      return;
    }
    if (integration) {
      integration = { ...integration, enabled: true };
      enabled = true;
      persist(integration);
      onChange(integration.integrationId);
      return;
    }
    const attempt = generation;
    busy = 'register';
    try {
      const registration = await client.register(uid);
      if (attempt !== generation) return;
      integration = { ...registration, enabled: true };
      enabled = true;
      persist(integration);
      onChange(integration.integrationId);
    } catch (cause) {
      if (attempt !== generation) return;
      error = cause instanceof Error ? cause.message : '暂时无法开启付款通知，请重试。';
    } finally {
      if (attempt === generation) busy = '';
    }
  }

  async function copyWebhook() {
    if (preview || !integration) return;
    const attempt = generation;
    try {
      await navigator.clipboard.writeText(integration.webhookUrl);
      if (attempt === generation) notice = '私密地址已复制，接着去爱发电后台粘贴并保存。';
    } catch {
      if (attempt === generation) notice = '无法自动复制，请在地址框中选中并手动复制。';
    }
  }

  async function checkConnection() {
    if (preview || !integration || !client || busy) return;
    const attempt = generation;
    busy = 'check';
    error = '';
    try {
      const result = await client.integrationStatus(integration.integrationId, integration.managementToken);
      if (attempt === generation) diagnostic = result.webhookReceived;
    } catch (cause) {
      if (attempt === generation) error = cause instanceof Error ? cause.message : '暂时无法查询通知，请稍后再试。';
    } finally {
      if (attempt === generation) busy = '';
    }
  }
</script>

<section class="author-payments" aria-labelledby="payment-settings-title">
  <div class="settings-heading">
    <div>
      <span class="settings-kicker">AN OPTIONAL LITTLE THANK-YOU</span>
      <h3 id="payment-settings-title">付款后，送上一张感谢小票。</h3>
      <p>设置爱发电通知，让支持者返回本站查看付款结果。</p>
    </div>
    <span class="optional-label">可选</span>
  </div>
  <button
    class="settings-toggle"
    type="button"
    role="switch"
    aria-checked={enabled}
    disabled={preview || !validId || Boolean(busy)}
    onclick={() => void toggle()}
  >
    <span>{#if busy === 'register'}<Spinner /> 正在准备…{:else}启用付款通知{/if}</span>
    <span class="switch-track" class:enabled aria-hidden="true"><span></span></span>
  </button>

  {#if preview}
    <p class="settings-help">演示模式不创建付款通知。填写自己的爱发电 ID 后即可设置。</p>
  {:else if !validId}
    <p class="settings-help">先填写上方的 32 位爱发电用户 ID。</p>
  {:else if enabled && integration}
    <div class="webhook-setup">
      <ol>
        <li>复制下面的私密地址。</li>
        <li>打开<a href="https://afdian.com/dashboard/dev" target="_blank" rel="noopener noreferrer">爱发电开发者后台 <Icon name="external" /></a>，粘贴到 Webhook URL 并保存。</li>
      </ol>
      <label for="author-webhook-url">私密 Webhook 地址</label>
      <div class="webhook-copy">
        <input
          id="author-webhook-url"
          readonly
          value={integration.webhookUrl}
          autocomplete="off"
          spellcheck={false}
          onclick={(event) => event.currentTarget.select()}
        />
        <button type="button" aria-label="复制私密 Webhook 地址" onclick={() => void copyWebhook()}><Icon name="copy" /><span>复制</span></button>
      </div>
      <p class="private-note"><Icon name="lock" /> 这条地址只填爱发电后台，不要放进 README。</p>
      <div class="connection-check">
        <button class="check-button" type="button" disabled={Boolean(busy)} onclick={() => void checkConnection()}>
          {#if busy === 'check'}<Spinner />{/if}检查通知连接
        </button>
        {#if diagnostic !== null}
          <span class:received={diagnostic} role="status">{diagnostic ? '已收到爱发电通知' : '还未收到通知'}</span>
        {/if}
      </div>
      <p class="settings-help">可在爱发电后台点“发送测试”，再检查连接。测试通知仅用于确认配置。</p>
    </div>
  {/if}

  {#if storageNotice}<p class="settings-feedback warning" role="status">{storageNotice}</p>{/if}
  {#if notice}<p class="settings-feedback" role="status">{notice}</p>{/if}
  {#if error}<p class="settings-feedback error" role="alert">{error}</p>{/if}
</section>

<style>
  .author-payments { margin: 4px 0; padding: 21px 0 0; border-top: 1px dashed var(--line); }
  .settings-heading { display: flex; align-items: flex-start; gap: 12px; justify-content: space-between; }
  .settings-kicker { color: var(--muted); font: 8px/1.6 var(--mono); letter-spacing: .06em; }
  h3 { margin: 6px 0 7px; font-size: 17px; line-height: 1.5; letter-spacing: -.035em; }
  p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.75; }
  .optional-label { border: 1px solid var(--line); padding: 3px 6px; flex-shrink: 0; color: var(--muted); font-size: 10px; }
  .settings-toggle { width: 100%; padding: 13px 0; margin: 7px 0 0; background: none; border: 0; color: var(--ink); text-align: left; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; font-weight: 650; font-size: 13px; }
  .settings-toggle > span:first-child { display: flex; gap: 8px; align-items: center; }
  .settings-toggle:disabled { cursor: default; opacity: .5; }
  .switch-track { display: inline-flex; align-items: center; width: 36px; height: 21px; padding: 3px; border: 1px solid var(--ink); border-radius: 20px; background: var(--paper); flex-shrink: 0; }
  .switch-track > span { width: 13px; height: 13px; background: var(--ink); border-radius: 50%; transition: transform .15s; }
  .switch-track.enabled { background: var(--yellow); }
  .switch-track.enabled > span { transform: translateX(15px); }
  .webhook-setup { border-top: 1px solid var(--line); padding-top: 12px; }
  ol { margin: 0 0 15px; padding-left: 20px; font-size: 12px; line-height: 1.9; }
  li + li { margin-top: 3px; }
  li a { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
  li a :global(svg) { display: inline; width: 12px; height: 12px; vertical-align: -2px; }
  label { display: block; font-size: 11px; font-weight: 650; margin-bottom: 7px; }
  .webhook-copy { display: flex; border: 1px solid var(--line); background: var(--white); min-width: 0; }
  .webhook-copy input { width: 100%; min-width: 0; border: 0; border-radius: 0; padding: 12px 9px; font: 10px var(--mono); color: var(--ink); background: transparent; }
  .webhook-copy button { display: flex; align-items: center; gap: 5px; flex-shrink: 0; padding: 10px 12px; border: 0; border-left: 1px solid var(--line); border-radius: 0; background: var(--yellow); font-size: 11px; cursor: pointer; color: var(--ink); }
  .webhook-copy button :global(svg) { width: 15px; height: 15px; }
  .private-note { display: flex; align-items: center; gap: 5px; margin: 8px 0 16px; font-size: 10px; }
  .private-note :global(svg) { width: 12px; height: 12px; flex-shrink: 0; }
  .connection-check { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .check-button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid var(--ink); background: transparent; color: var(--ink); cursor: pointer; font-size: 11px; }
  .check-button:disabled { opacity: .6; cursor: default; }
  .connection-check > span { font-size: 11px; color: var(--muted); }
  .connection-check > .received { color: var(--green); }
  .settings-help { font-size: 11px; }
  .settings-feedback { margin-top: 10px; padding: 9px 10px; background: var(--paper); border-left: 2px solid var(--yellow); font-size: 11px; overflow-wrap: anywhere; }
  .settings-feedback.error { color: var(--red); border-left-color: var(--red); }
  .settings-feedback.warning { color: var(--ink); }
  button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) { .switch-track > span { transition: none; } }
</style>

<script lang="ts">
  import { tick } from 'svelte';
  import { BADGE_LANGUAGES, getBadgeLanguage } from '../lib/badges.js';
  import { validateStripePaymentLink } from '../lib/stripe.js';
  import type { AppController } from '../lib/types';
  import AfdianIcon from './AfdianIcon.svelte';
  import AuthorPayments, { type PaymentSetupDraft } from './AuthorPayments.svelte';
  import ErrorBox from './ErrorBox.svelte';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';
  import StripeIcon from './StripeIcon.svelte';
  import Steps from './Steps.svelte';

  let { controller }: { controller: AppController } = $props();
  const appState = $derived(controller.state);
  const busy = $derived(Boolean(appState.busy));
  const shareUrl = $derived(appState.config ? controller.shareUrl() : '');
  const badgeMarkup = $derived(appState.config ? controller.badgeMarkup() : null);
  const selectedBadge = $derived(getBadgeLanguage(appState.badgeLanguage));
  let afdianSetupDraft = $state<PaymentSetupDraft | null>(null);
  let stripeSetupDraft = $state<PaymentSetupDraft | null>(null);
  const afdianConfigured = $derived(/^[a-f0-9]{32}$/i.test(appState.author.afdianId.trim()));
  const stripeConfigured = $derived.by(() => {
    try { return Boolean(validateStripePaymentLink(appState.author.stripePaymentLink)); } catch { return false; }
  });
  let identityInput: HTMLInputElement | undefined = $state();
  let invalidIdentity = $state(false);

  async function submitIdentity() {
    invalidIdentity = false;
    await tick();
    await controller.connectAuthor();
    if (appState.step === 1 && appState.error) {
      invalidIdentity = true;
      await tick();
      identityInput?.focus();
      identityInput?.getAnimations().forEach((animation) => {
        animation.currentTime = 0;
        animation.play();
      });
    }
  }
</script>

<main id="main" class="author-main">
  <section class="builder author-builder wrap" id="create" aria-label="创建赞助页">
    <h1 class="page-title">Buy me a Big Mac</h1>
    <Steps items={['您的信息', '选择餐厅', '选择赞助方式', '分享链接']} active={appState.step} />
    <div class="setup-panel">
      {#key appState.step}
      <div class="setup-scroll">
      {#if appState.step === 1}
        <div class="author-layout">
          <nav class="setup-nav" aria-labelledby="recipient-nav-title">
            <h2 id="recipient-nav-title" class="setup-nav-title">赞助给</h2>
            <div class="setup-nav-items">
              <button
                type="button"
                class:active={appState.author.sponsorType === 'person'}
                aria-pressed={appState.author.sponsorType === 'person'}
                disabled={busy}
                onclick={() => { invalidIdentity = false; controller.setSponsorType('person'); }}
              >
                <span class="nav-icon"><Icon name="heart" /></span>
                <b>赞助我</b>
                <span class="nav-arrow"><Icon name="arrow" /></span>
              </button>
              <button
                type="button"
                class:active={appState.author.sponsorType === 'project'}
                aria-pressed={appState.author.sponsorType === 'project'}
                disabled={busy}
                onclick={() => { invalidIdentity = false; controller.setSponsorType('project'); }}
              >
                <span class="nav-icon"><Icon name="github" /></span>
                <b>赞助项目</b>
                <span class="nav-arrow"><Icon name="arrow" /></span>
              </button>
            </div>
          </nav>
          <form
            id="author-connect"
            class="setup-content form-stack"
            novalidate
            onsubmit={(event) => {
              event.preventDefault();
              void submitIdentity();
            }}
          >
            {#if appState.author.sponsorType === 'person'}
              <div class="field">
                <span><label for="author-name">您的名字</label></span>
                <input
                  id="author-name"
                  name="name"
                  bind:this={identityInput}
                  class:identity-invalid={invalidIdentity}
                  aria-invalid={invalidIdentity || undefined}
                  aria-describedby={invalidIdentity ? 'identity-error' : undefined}
                  value={appState.author.name}
                  oninput={(event) => { invalidIdentity = false; controller.setAuthorField('name', event.currentTarget.value); }}
                  placeholder="希望大家怎么称呼您？"
                  required
                  autocomplete="name"
                  maxlength="60"
                />
              </div>
            {:else}
              <div class="field">
                <span><label for="author-repository">您的项目地址</label></span>
                <input
                  id="author-repository"
                  name="repo"
                  bind:this={identityInput}
                  class:identity-invalid={invalidIdentity}
                  aria-invalid={invalidIdentity || undefined}
                  aria-describedby={invalidIdentity ? 'identity-error' : undefined}
                  value={appState.author.repo}
                  oninput={(event) => { invalidIdentity = false; controller.setAuthorField('repo', event.currentTarget.value); }}
                  placeholder="github.com/user/project"
                  required
                  autocomplete="off"
                  spellcheck={false}
                  maxlength="200"
                />
              </div>
            {/if}
            {#if invalidIdentity}<span class="sr-only" id="identity-error" role="alert">{appState.error}</span>{/if}
          </form>
        </div>
      {:else if appState.step === 2}
        <div class="store-setup">
          <p class="step-intro">选择您附近的餐厅，我们会为赞助者提供此餐厅的实时餐品和参考价格。建议您选择 24h 营业餐厅</p>
          <form
            id="store-search"
            class="restaurant-search"
            onsubmit={(event) => {
              event.preventDefault();
              void controller.searchStores();
            }}
          >
            <label class="field service-field">
              <span>取餐方式</span>
              <div class="select-control">
                <select
                  name="beType"
                  value={appState.author.beType}
                  disabled={busy}
                  onchange={(event) => controller.setBeType(Number(event.currentTarget.value) === 5 ? 5 : 1)}
                >
                  <option value={1}>自取</option>
                  <option value={5}>得来速</option>
                </select>
                <Icon name="chevron-down" />
              </div>
            </label>
            <label class="field city-field">
              <span>城市</span>
              <input
                name="city"
                placeholder="北京"
                value={appState.author.city}
                oninput={(event) => controller.setAuthorField('city', event.currentTarget.value)}
                required
                maxlength="40"
              />
            </label>
            <label class="field keyword-field">
              <span>街道、商圈或餐厅</span>
              <input
                name="keyword"
                placeholder="朝阳公园"
                value={appState.author.keyword}
                oninput={(event) => controller.setAuthorField('keyword', event.currentTarget.value)}
                required
                maxlength="80"
              />
            </label>
            <button class="button dark search-button" type="submit" disabled={busy} aria-label="搜索餐厅">
              {#if appState.busy === 'stores'}<Spinner />{:else}<Icon name="search" />{/if}
            </button>
          </form>
          <ErrorBox message={appState.error} />
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users can scroll the restaurant results.) -->
          <div class="store-results" role="region" aria-label="餐厅搜索结果" tabindex="0">
            {#each appState.stores as store, index (`${store.storeCode}-${index}`)}
              <button
                type="button"
                class="store-option"
                class:selected={appState.selected === index}
                data-action="select-store"
                data-index={index}
                disabled={busy}
                aria-pressed={appState.selected === index}
                onclick={() => controller.selectStore(index)}
              >
                <span class="store-pin"><Icon name="pin" /></span>
                <span class="store-copy">
                  <strong>{store.storeName}</strong>
                  <small>{store.address || '以餐厅实际营业信息为准'}</small>
                  <em>{store.distance || ''}{store.businessStatus === false ? ' · 当前未营业' : ''}</em>
                </span>
                <span class="radio-mark">
                  {#if appState.selected === index}<Icon name="check" />{/if}
                </span>
              </button>
            {:else}
              <div class="empty-state">
                <Icon name="pin" />
                <strong>{appState.searched ? '这里还没有找到餐厅' : '从您熟悉的街区开始'}</strong>
                <p>{appState.searched ? '试试附近的街道、商圈，或换一个关键词。' : '输入城市和位置关键词，找到您附近的麦当劳。'}</p>
              </div>
            {/each}
          </div>
        </div>
      {:else if appState.step === 3}
        <div class="author-layout">
          <nav class="setup-nav channel-nav" aria-labelledby="channel-nav-title">
            <h2 id="channel-nav-title" class="setup-nav-title">赞助渠道</h2>
            <div class="setup-nav-items channel-items">
              <button type="button" class:active={appState.author.paymentProvider === 'afdian'}
                aria-pressed={appState.author.paymentProvider === 'afdian'} disabled={busy}
                onclick={() => controller.setPaymentProvider('afdian')}>
                <span class="nav-icon"><AfdianIcon /></span>
                <b>爱发电</b>
                {#if afdianConfigured}<span class="channel-ready" aria-label="已配置"><Icon name="check" /></span>{/if}
              </button>
              <button type="button" class:active={appState.author.paymentProvider === 'stripe'}
                aria-pressed={appState.author.paymentProvider === 'stripe'} disabled={busy}
                onclick={() => controller.setPaymentProvider('stripe')}>
                <span class="nav-icon"><StripeIcon /></span>
                <b>Stripe</b>
                {#if stripeConfigured}<span class="channel-ready" aria-label="已配置"><Icon name="check" /></span>{/if}
              </button>
            </div>
          </nav>
          <form
            id="author-payment"
            class="setup-content form-stack"
            novalidate
            onsubmit={(event) => {
              event.preventDefault();
              controller.generateLink();
            }}
          >
            {#if appState.author.paymentProvider === 'stripe'}
              <div class="field">
                <span>
                  <label for="author-stripe-payment-link">Stripe 支付链接</label>
                  <a href="https://github.com/KairuiLiu/buy-me-a-big-mac/blob/main/docs/stripe.md" target="_blank" rel="noopener noreferrer">
                    配置指南 <Icon name="external" />
                  </a>
                </span>
                <input
                  id="author-stripe-payment-link"
                  name="stripePaymentLink"
                  type="url"
                  value={appState.author.stripePaymentLink}
                  oninput={(event) => controller.setAuthorField('stripePaymentLink', event.currentTarget.value)}
                  placeholder="https://buy.stripe.com/..."
                  autocomplete="off"
                  spellcheck={false}
                  maxlength="500"
                />
              </div>
            {:else}
            <div class="field">
              <span>
                <label for="author-afdian-id">爱发电用户 ID</label>
                <a href="https://afdian.com/dashboard/dev" target="_blank" rel="noopener noreferrer">
                  查看我的 ID <Icon name="external" />
                </a>
              </span>
              <input
                id="author-afdian-id"
                name="afdianId"
                value={appState.author.afdianId}
                oninput={(event) => controller.setAuthorField('afdianId', event.currentTarget.value)}
                placeholder="开发者页面中的 32 位 user_id"
                autocomplete="off"
                spellcheck={false}
                maxlength="32"
              />
            </div>
            {/if}
            <AuthorPayments afdianId={appState.author.afdianId}
              stripePaymentLink={appState.author.stripePaymentLink}
              preview={appState.preview} paymentProvider={appState.author.paymentProvider}
              bind:afdianDraft={afdianSetupDraft} bind:stripeDraft={stripeSetupDraft}
              onChange={(enabled) => appState.author.paymentProvider === 'stripe'
                ? controller.setStripeReturn(enabled) : controller.setPaymentNotifications(enabled)} />
            <ErrorBox message={appState.error} />
          </form>
        </div>
      {:else}
        <div class="share-setup">
          <div class="badge-section">
            <div class="preview-heading">
              <span class="preview-label">预览效果</span>
              <div class="select-control badge-language">
                <select id="badge-language" aria-label="按钮样式" value={appState.badgeLanguage} onchange={(event) => controller.setBadgeLanguage(event.currentTarget.value)}>
                  {#each BADGE_LANGUAGES as language (language.value)}
                    <option value={language.value}>{language.label}</option>
                  {/each}
                </select>
                <Icon name="chevron-down" />
              </div>
            </div>
            <div class="badge-preview">
              <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                <img src={selectedBadge.asset} alt={`${selectedBadge.text} 按钮预览`} width={selectedBadge.width} height={selectedBadge.height ?? 52} />
              </a>
            </div>
          </div>
          <div class="field">
            <span><label for="share-url">您的赞助链接</label></span>
            <div class="copy-input">
              <input id="share-url" readonly value={shareUrl} />
              <button
                type="button"
                class="icon-button"
                data-action="copy-link"
                aria-label="复制链接"
                onclick={() => void controller.copy('link')}
              ><Icon name="copy" /></button>
            </div>
          </div>
          <div class="field embed-field">
            <div class="code-heading">
              <label for="embed-code">嵌入代码</label>
              <div class="segmented" role="group" aria-label="徽章代码格式">
                <button
                  type="button"
                  data-action="code-tab"
                  data-value="markdown"
                  class:active={appState.codeTab === 'markdown'}
                  aria-pressed={appState.codeTab === 'markdown'}
                  onclick={() => controller.setCodeTab('markdown')}
                >Markdown</button>
                <button
                  type="button"
                  data-action="code-tab"
                  data-value="html"
                  class:active={appState.codeTab === 'html'}
                  aria-pressed={appState.codeTab === 'html'}
                  onclick={() => controller.setCodeTab('html')}
                >HTML</button>
              </div>
            </div>
            <div class="code-editor">
              <textarea
                id="embed-code"
                class="code-box"
                readonly
                rows="5"
                value={badgeMarkup?.[appState.codeTab] || ''}
              ></textarea>
              <button
                type="button"
                class="code-copy"
                data-action="copy-code"
                aria-label="复制嵌入代码"
                title="复制嵌入代码"
                onclick={() => void controller.copy('code')}
              ><Icon name="copy" /></button>
            </div>
          </div>
        </div>
      {/if}
      </div>
      {/key}
      <div class="setup-actions form-actions" class:with-nav={appState.step === 1 || appState.step === 3} class:next-action={appState.step === 1}>
        {#if appState.step === 1}
          <button class="button primary" disabled={busy} type="submit" form="author-connect">
            {#if appState.busy === 'connect'}
              <Spinner /> 正在准备餐厅…
            {:else}
              下一步，选择餐厅 <Icon name="arrow" />
            {/if}
          </button>
        {:else if appState.step === 2}
          <button type="button" class="text-button" data-action="back-connect" disabled={busy} onclick={() => controller.backToProject()}>← 返回修改</button>
          <button type="button" class="button primary" data-action="continue-payment" disabled={appState.selected === null || busy} onclick={() => controller.continueToPayment()}>选好了 <Icon name="arrow" /></button>
        {:else if appState.step === 3}
          <button type="button" class="text-button" disabled={busy} onclick={() => controller.backToStores()}>← 返回餐厅</button>
          <button class="button primary" type="submit" form="author-payment" data-action="generate" disabled={busy}>生成赞助链接 <Icon name="arrow" /></button>
        {:else}
          <button type="button" class="text-button" data-action="back-store" onclick={() => controller.backToStores()}>← 换一家餐厅</button>
        {/if}
      </div>
    </div>
  </section>
</main>

<style>
  .author-builder { --rail-size: 152px; --panel-height: 680px; --store-height: 96px; padding-top: 32px; padding-bottom: 58px; scroll-margin-top: 32px; }
  .page-title { flex-shrink: 0; margin: 0 0 24px; font-size: clamp(28px, 3vw, 42px); line-height: 1.25; }
  .setup-panel { height: var(--panel-height); display: flex; flex-direction: column; overflow: hidden; overflow-anchor: none; border: 1px solid var(--ink); border-top: 0; background: var(--paper); }
  .setup-scroll { flex: 1; min-height: 0; overflow: hidden; }
  .author-layout { display: grid; grid-template-columns: var(--rail-size) minmax(0, 1fr); height: 100%; min-height: 0; }
  .setup-nav { min-width: 0; padding-top: 28px; background: var(--paper); border-right: 1px solid var(--line); display: flex; flex-direction: column; }
  .setup-nav button { width: 100%; min-height: 62px; flex-shrink: 0; padding: 18px 12px; display: grid; grid-template-columns: 20px minmax(0, 1fr) 12px; align-items: center; gap: 8px; text-align: left; font-size: 12px; line-height: 1.5; color: var(--ink); background: transparent; border: 0; border-block: 1px solid transparent; border-radius: 0; }
  .setup-nav button b { font-weight: 600; }
  .setup-nav button:hover:not(.active):not(:disabled) { background: #eae6da; }
  .setup-nav button.active { background: var(--yellow); border-block-color: var(--ink); }
  .setup-nav button.active b { font-weight: 700; }
  .setup-nav button:focus-visible { outline: 2px solid var(--ink); outline-offset: -4px; }
  .nav-icon, .nav-arrow { display: flex; align-items: center; justify-content: center; height: 20px; }
  .nav-icon { color: var(--muted); }
  .nav-icon :global(svg) { display: block; width: 20px; height: 20px; }
  .nav-icon :global(.afdian-icon) { width: 26px; height: 26px; }
  .nav-arrow { opacity: 0; }
  .nav-arrow :global(svg) { display: block; width: 12px; height: 12px; }
  .setup-nav button.active .nav-icon { color: var(--ink); }
  .setup-nav button.active .nav-arrow { opacity: 1; }
  .setup-nav-title { margin: 0; padding: 0 12px 24px; font: 700 16px/1.5 var(--sans); }
  .setup-nav-items { display: flex; flex-direction: column; }
  .channel-items button { grid-template-columns: 20px minmax(0, 1fr) 12px; }
  .channel-ready { display: inline-flex; align-items: center; justify-content: center; color: var(--green); }
  .channel-ready :global(svg) { display: block; width: 12px; height: 12px; }
  .setup-content { padding: 32px 36px; min-width: 0; min-height: 0; width: 100%; overflow-y: auto; }
  .form-stack { gap: 22px; }
  .field > span { font-size: 12px; margin-bottom: 10px; }
  .field > span > a { font-size: 10px; }
  input, select { min-height: 48px; border: 1px solid var(--line); border-radius: 0; padding: 12px 14px; background: var(--white); font-size: 12px; }
  input:hover, select:hover { border-color: var(--muted); }
  input.identity-invalid { border-color: var(--red); outline-color: var(--red); box-shadow: inset 0 0 0 1px var(--red); animation: identity-flash .32s ease-in-out 2; }
  @keyframes identity-flash { 50% { border-color: var(--line); box-shadow: none; } }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  .setup-actions { flex-shrink: 0; margin: 0; padding: 24px 36px 32px; background: var(--paper); }
  .setup-actions.with-nav { margin-left: calc(var(--rail-size) - 1px); border-left: 1px solid var(--line); }
  .setup-actions.next-action { justify-content: flex-end; }
  .button { border-radius: 0; box-shadow: none; }
  .store-setup, .share-setup { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 32px 36px; overflow-y: auto; }
  .step-intro { flex-shrink: 0; margin: 0 0 24px; font-size: 12px; color: var(--muted); line-height: 1.8; }
  .restaurant-search { display: grid; flex-shrink: 0; grid-template-columns: 132px minmax(90px, 1fr) minmax(0, 2fr) 48px; align-items: end; gap: 12px; }
  .select-control { position: relative; }
  select { appearance: none; padding-right: 38px; font: inherit; font-size: 12px; }
  .select-control :global(svg) { position: absolute; width: 15px; height: 15px; top: 50%; right: 14px; transform: translateY(-50%); pointer-events: none; color: var(--ink); }
  .search-button { padding: 12px; }
  .store-results { flex: 1 1 0; min-height: calc(3 * var(--store-height)); margin-top: 20px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--muted) var(--paper); }
  .store-results:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
  .store-option { height: var(--store-height); margin: 0; padding: 14px 16px; border-radius: 0; box-shadow: none; }
  .store-option + .store-option { border-top: 0; }
  .store-option:hover { background: #fff7df; }
  .store-option.selected { background: #fff1bc; border-color: var(--ink); box-shadow: inset 0 1px var(--ink); }
  .store-option.selected .radio-mark { color: var(--yellow); background: var(--ink); border-color: var(--ink); }
  .store-copy strong, .store-copy small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .store-pin { flex-shrink: 0; }
  .empty-state { height: 100%; margin: 0; border-radius: 0; box-shadow: none; }
  .share-setup { gap: 22px; }
  .badge-section { flex-shrink: 0; }
  .preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .badge-preview { flex-shrink: 0; background: var(--paper); border: 1px solid var(--ink); border-radius: 0; padding: 64px 16px; margin: 0; }
  .badge-preview img { display: block; max-width: 100%; height: auto; }
  .badge-language { width: 156px; max-width: 60%; }
  .badge-language select { min-height: 36px; padding-top: 8px; padding-bottom: 8px; font-size: 11px; }
  .preview-label { color: var(--ink); font-size: 12px; font-weight: 600; }
  .copy-input input, .icon-button { border-radius: 0; }
  .icon-button:hover, .segmented button:hover:not(.active) { background: var(--paper); }
  .code-heading { margin: 0 0 10px; min-height: 28px; }
  .code-heading label { font-size: 12px; font-weight: 600; }
  .segmented, .segmented button { border-radius: 0; box-shadow: none; }
  .code-heading .segmented button { padding: 6px 10px; font: 10px var(--mono); }
  .code-editor { position: relative; }
  .code-box { display: block; height: 150px; padding: 13px 48px 13px 14px; resize: none; overflow-wrap: anywhere; border-radius: 0; }
  .code-copy { position: absolute; top: 1px; right: 1px; width: 36px; height: 36px; padding: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 0; background: var(--paper); color: var(--muted); transition: color .15s; }
  .code-copy :global(svg) { width: 15px; height: 15px; }
  .code-copy:hover { color: var(--ink); }
  .code-copy:focus-visible { color: var(--ink); outline: 2px solid var(--ink); outline-offset: -4px; }
  @media (max-width: 760px) {
    .author-main { display: flex; flex-direction: column; min-height: 0; }
    .author-builder { display: flex; flex-direction: column; flex: 1; min-height: 0; padding-top: 16px; padding-bottom: 0; }
    .page-title { margin-bottom: 16px; font-size: clamp(24px, 6vw, 28px); }
    .author-builder :global(.steps) { flex-shrink: 0; }
    .setup-panel { flex: 1; min-height: 0; height: auto; }
    .setup-scroll { overflow-y: auto; scroll-padding-block: 16px; }
    .author-layout { display: flex; flex-direction: column; height: auto; min-height: 100%; }
    .setup-nav { padding-top: 18px; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: hidden; }
    .setup-nav button { position: relative; flex: 1 1 0; width: auto; min-width: 0; min-height: 56px; padding: 14px 16px; display: flex; justify-content: center; }
    .setup-nav button.active { background: transparent; border-block-color: transparent; }
    .setup-nav button:hover:not(.active):not(:disabled) { background: transparent; }
    .setup-nav button.active::after { content: ''; position: absolute; inset: auto 16px 0; height: 3px; background: var(--red); }
    .setup-nav .nav-arrow { display: none; }
    .setup-nav-title { padding: 0 16px 12px; font-size: 14px; }
    .setup-nav-items { flex-direction: row; overflow-x: auto; }
    .setup-content, .store-setup, .share-setup { padding: 28px; overflow: visible; }
    .store-setup, .share-setup { height: auto; min-height: 100%; }
    .store-results { flex: none; min-height: 0; overflow: visible; }
    .empty-state { min-height: 180px; }
    .setup-actions, .setup-actions.with-nav { margin: 0; padding: 12px 16px max(12px, env(safe-area-inset-bottom)); border-left: 0; border-top: 1px solid var(--line); gap: 12px; }
    .setup-actions .text-button { min-height: 48px; }
    .restaurant-search { grid-template-columns: 110px minmax(80px, 1fr) minmax(0, 1.7fr) 44px; gap: 9px; }
    .restaurant-search input, select { padding-left: 10px; }
    .author-builder input, .author-builder select, .author-builder textarea { font-size: 16px; }
  }
  @media (max-width: 580px) {
    .author-builder { padding-top: 16px; }
    .author-builder :global(.steps) { padding: 0 10px; gap: 0; justify-content: space-between; min-height: 56px; }
    .author-builder :global(.steps li) { font-size: 9px; gap: 4px; }
    .author-builder :global(.steps li + li::before) { padding: 0 4px; margin: 0; }
    .author-builder :global(.steps li > span) { min-width: 16px; width: 16px; height: 18px; font-size: 9px; }
    .setup-content, .store-setup, .share-setup { padding: 24px 16px; }
    .restaurant-search { grid-template-columns: 1fr 1fr 44px; gap: 15px 9px; }
    .service-field { grid-column: 1; }
    .city-field { grid-column: 2 / 4; }
    .keyword-field { grid-column: 1 / 3; }
    .step-intro { margin-bottom: 20px; font-size: 11px; }
    .field > span, .code-heading label, .preview-label { font-size: 11px; }
    .field > span > a { font-size: 9px; }
    .form-actions { gap: 12px; }
    .form-actions .button, .next-action .button { padding: 13px 12px; font-size: 11px; gap: 7px; }
    .form-actions .text-button { font-size: 11px; }
    .store-option { padding: 12px; gap: 10px; }
  }
  @media (max-width: 360px) {
    .author-builder :global(.steps) { padding-inline: 6px; }
    .author-builder :global(.steps li) { gap: 3px; }
    .author-builder :global(.steps li + li::before) { padding-inline: 2px; }
  }
  @media (prefers-reduced-motion: reduce) { input.identity-invalid { animation: none; } .code-copy { transition: none; } }
</style>

<script lang="ts">
  import type { AppController } from '../lib/types';
  import AuthorHero from './AuthorHero.svelte';
  import AuthorReceipt from './AuthorReceipt.svelte';
  import AuthorPayments from './AuthorPayments.svelte';
  import ErrorBox from './ErrorBox.svelte';
  import HowItWorks from './HowItWorks.svelte';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';
  import Steps from './Steps.svelte';

  let { controller }: { controller: AppController } = $props();
  const state = $derived(controller.state);
  const busy = $derived(Boolean(state.busy));
  const shareUrl = $derived(state.config ? controller.shareUrl() : '');
  const badgeMarkup = $derived(state.config ? controller.badgeMarkup() : null);
</script>

<main id="main">
  <AuthorHero {controller} />
  <section class="builder wrap" id="create">
    <div class="builder-title">
      <div>
        <span class="eyebrow">FOR THE MAINTAINERS</span>
        <h2>给开源，开个小餐厅。</h2>
      </div>
      <span class="connection-status" class:online={state.connected}>
        <i></i>
        {state.connected ? (state.preview ? '示例菜单已就绪' : 'MCP 已连接') : '三步，准备开张'}
      </span>
    </div>
    <Steps items={['设置项目', '选择餐厅', '分享给社区']} active={state.step} />
    <div class="builder-grid">
      <div class="panel">
        {#if state.step === 1}
          <div class="panel-heading">
            <span class="eyebrow">01 / MAKE IT YOURS</span>
            <h2>你的项目，值得被请客。</h2>
            <p>填好项目和收款信息，再选一家你喜欢的餐厅。</p>
          </div>
          <form
            id="author-connect"
            class="form-stack"
            onsubmit={(event) => {
              event.preventDefault();
              void controller.connectAuthor();
            }}
          >
            <div class="field">
              <span><label for="author-repository">GitHub 项目</label></span>
              <div class="input-icon">
                <Icon name="github" />
                <input
                  id="author-repository"
                  name="repo"
                  value={state.author.repo}
                  oninput={(event) => controller.setAuthorField('repo', event.currentTarget.value)}
                  placeholder="github.com/你的名字/你的项目"
                  required
                  autocomplete="off"
                  spellcheck={false}
                  maxlength="200"
                />
              </div>
            </div>
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
                value={state.author.afdianId}
                oninput={(event) => controller.setAuthorField('afdianId', event.currentTarget.value)}
                placeholder="开发者页面中的 32 位 user_id"
                required
                autocomplete="off"
                spellcheck={false}
                maxlength="32"
              />
            </div>
            <ErrorBox message={state.error} />
            <button class="button primary full" disabled={busy} type="submit">
              {#if state.busy === 'connect'}
                <Spinner /> 正在连接麦当劳…
              {:else}
                下一步，选择餐厅 <Icon name="arrow" />
              {/if}
            </button>
          </form>
        {:else if state.step === 2}
          <div class="panel-heading">
            <span class="eyebrow">02 / YOUR NEIGHBORHOOD</span>
            <h2>选一家你喜欢的餐厅。</h2>
            <p>赞助者将看到这家餐厅的菜单，用它计算建议金额。</p>
          </div>
          <div class="switch-line">
            <div class="segmented" role="group" aria-label="就餐方式">
              <button
                type="button"
                data-action="be-type"
                data-value="1"
                class:active={state.author.beType === 1}
                aria-pressed={state.author.beType === 1}
                disabled={busy}
                onclick={() => controller.setBeType(1)}
              >到店自取</button>
              <button
                type="button"
                data-action="be-type"
                data-value="5"
                class:active={state.author.beType === 5}
                aria-pressed={state.author.beType === 5}
                disabled={busy}
                onclick={() => controller.setBeType(5)}
              >得来速</button>
            </div>
            <button
              type="button"
              class="text-button"
              data-action="locate"
              disabled={busy}
              onclick={() => void controller.locate()}
            >
              {#if state.busy === 'locate'}<Spinner />{:else}<Icon name="pin" />{/if}
              使用我的位置
            </button>
          </div>
          <form
            id="store-search"
            class="search-form"
            onsubmit={(event) => {
              event.preventDefault();
              void controller.searchStores();
            }}
          >
            <label class="field">
              <span>城市</span>
              <input
                name="city"
                placeholder="例如：上海"
                value={state.author.city}
                oninput={(event) => controller.setAuthorField('city', event.currentTarget.value)}
                required
                maxlength="40"
              />
            </label>
            <label class="field">
              <span>街道、商圈或餐厅</span>
              <input
                name="keyword"
                placeholder="例如：人民广场"
                value={state.author.keyword}
                oninput={(event) => controller.setAuthorField('keyword', event.currentTarget.value)}
                required
                maxlength="80"
              />
            </label>
            <button class="button dark" type="submit" disabled={busy} aria-label="搜索餐厅">
              {#if state.busy === 'stores'}<Spinner />{:else}<Icon name="search" />{/if}
            </button>
          </form>
          <ErrorBox message={state.error} />
          <div class="store-results">
            {#each state.stores as store, index (`${store.storeCode}-${index}`)}
              <button
                type="button"
                class="store-option"
                class:selected={state.selected === index}
                data-action="select-store"
                data-index={index}
                disabled={busy}
                aria-pressed={state.selected === index}
                onclick={() => controller.selectStore(index)}
              >
                <span class="store-pin"><Icon name="pin" /></span>
                <span class="store-copy">
                  <strong>{store.storeName}</strong>
                  <small>{store.address || '以餐厅实际营业信息为准'}</small>
                  <em>{store.distance || ''}{store.businessStatus === false ? ' · 当前未营业' : ''}</em>
                </span>
                <span class="radio-mark">
                  {#if state.selected === index}<Icon name="check" />{/if}
                </span>
              </button>
            {:else}
              <div class="empty-state">
                <Icon name="pin" />
                <strong>{state.searched ? '这里还没有找到餐厅' : '从你熟悉的街区开始'}</strong>
                <p>
                  {state.searched
                    ? '换一个地标，或使用当前位置再找找。'
                    : '输入城市和位置关键词，或使用定位查找附近餐厅。'}
                </p>
              </div>
            {/each}
          </div>
          <div class="form-actions">
            <button
              type="button"
              class="text-button"
              data-action="back-connect"
              disabled={busy}
              onclick={() => controller.backToProject()}
            >← 返回修改</button>
            <button
              type="button"
              class="button primary"
              data-action="generate"
              disabled={state.selected === null || busy}
              onclick={() => controller.generateLink()}
            >生成我的请客链接 <Icon name="arrow" /></button>
          </div>
        {:else}
          <div class="panel-heading">
            <span class="success-label"><Icon name="check" /> 入口准备好了</span>
            <h2>把小汉堡，放进 README。</h2>
            <p>下一份来自开源社区的感谢，就从这里开始。</p>
          </div>
          {#key state.config?.afdianId}
            <AuthorPayments afdianId={state.config?.afdianId || ''} preview={state.preview}
              onChange={(id) => controller.setNotificationIntegrationId(id)} />
          {/key}
          <div class="badge-preview">
            <a href={shareUrl} target="_blank" rel="noopener noreferrer">
              <img src="/assets/badge.svg" alt="Buy me a Big Mac 按钮预览" width="224" height="52" />
            </a>
            <span>点击预览赞助者看到的页面 ↗</span>
          </div>
          <div class="field">
            <span><label for="share-url">你的专属链接</label></span>
            <div class="copy-input">
              <input id="share-url" readonly value={shareUrl} aria-label="专属请客链接" />
              <button
                type="button"
                class="icon-button"
                data-action="copy-link"
                aria-label="复制链接"
                onclick={() => void controller.copy('link')}
              ><Icon name="copy" /></button>
            </div>
          </div>
          <div class="code-heading">
            <div class="segmented" role="group" aria-label="徽章代码格式">
              <button
                type="button"
                data-action="code-tab"
                data-value="markdown"
                class:active={state.codeTab === 'markdown'}
                aria-pressed={state.codeTab === 'markdown'}
                onclick={() => controller.setCodeTab('markdown')}
              >Markdown</button>
              <button
                type="button"
                data-action="code-tab"
                data-value="html"
                class:active={state.codeTab === 'html'}
                aria-pressed={state.codeTab === 'html'}
                onclick={() => controller.setCodeTab('html')}
              >HTML</button>
            </div>
            <button
              type="button"
              class="text-button"
              data-action="copy-code"
              onclick={() => void controller.copy('code')}
            ><Icon name="copy" /> 复制代码</button>
          </div>
          <textarea
            class="code-box"
            readonly
            aria-label="README 按钮代码"
            rows="5"
            value={badgeMarkup?.[state.codeTab] || ''}
          ></textarea>
          <div class="form-actions">
            <button
              type="button"
              class="text-button"
              data-action="back-store"
              onclick={() => controller.backToStores()}
            >← 换一家餐厅</button>
            <a class="button primary" href={shareUrl} target="_blank" rel="noopener noreferrer">
              预览请客页面 <Icon name="external" />
            </a>
          </div>
        {/if}
      </div>
      <AuthorReceipt {controller} />
    </div>
  </section>
  <HowItWorks />
</main>

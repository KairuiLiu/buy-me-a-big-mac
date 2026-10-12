import { McdClient } from './lib/mcp.js';
import { parseGithubRepo, validateAfdianId, normalizeConfig, decodeConfig, createShareUrl, createBadgeMarkup, buildAfdianUrl, formatMoney, safeHttpsUrl } from './lib/domain.js';

const app = document.querySelector('#app');
const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  github: '<path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-1.4-.5-2 3.3-.4 6.5-1.6 6.5-7a5.5 5.5 0 0 0-1.5-3.8c.2-.8.2-2-.2-3.2 0 0-1.2-.4-3.8 1.4a13 13 0 0 0-7 0C5.9 1.6 4.7 2 4.7 2c-.4 1.2-.4 2.4-.2 3.2A5.5 5.5 0 0 0 3 9c0 5.4 3.2 6.6 6.5 7-.6.6-.6 1.4-.5 2v4"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  external: '<path d="M14 3h7v7m0-7L10 14m0-9H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
let epoch = 0;
let client = null;
let state;
let toastTimer;
const baseUrl = () => new URL(location.pathname, location.origin).toString();
const badgeUrl = () => new URL('./assets/badge.svg', baseUrl()).toString();
const pending = (key) => state.busy === key;
const busyAttr = () => state.busy ? 'disabled' : '';
const spinner = '<span class="spinner" aria-hidden="true"></span>';

function reset() {
  epoch++;
  client?.disconnect();
  client = null;
  state = { role:'author', step:1, connected:false, busy:'', error:'', config:null, badLink:false,
    author:{repo:'',afdianId:'',city:'',keyword:'',beType:1}, stores:[], searched:false, selected:null,
    menu:null, category:-1, search:'', cart:[], quote:null, quotedAt:0, blessing:0, customBlessing:'', codeTab:'markdown' };
  const hash = location.hash;
  if (hash.startsWith('#/gift/')) {
    state.role = 'gift';
    try { state.config = decodeConfig(hash.slice(7)); } catch { state.badLink = true; }
  } else if (hash && hash !== '#create' && hash !== '#how-it-works') {
    state.badLink = true;
    state.role = 'gift';
  }
  render();
  if (state.role === 'gift' && !state.badLink) void loadGiftMenu();
}

function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

async function task(key, work, commit) {
  if (state.busy) return;
  const current = epoch;
  state.busy = key;
  state.error = '';
  render();
  try {
    const result = await work();
    if (current === epoch) commit(result);
  } catch (error) {
    if (current === epoch) state.error = error.message || '暂时无法完成，请稍后重试。';
  } finally {
    if (current === epoch) { state.busy = ''; render(); if(state.error) document.querySelector('.error-box')?.focus(); }
  }
}

function header() {
  return `<header class="header wrap">
    <a class="brand" href="#create" data-action="home" aria-label="Buy me a Big Mac 首页"><img src="./assets/mark.svg" alt="" width="42" height="42"/><span>Buy me a <strong>Big Mac<span class="brand-dot">.</span></strong></span></a>
    <nav aria-label="主要导航"><a href="#how-it-works" data-action="how">怎么玩</a><a class="nav-create" href="#create" data-action="home">${state.role === 'gift' ? '我也想创建' : '给开源加个餐'} ${icon('arrow')}</a></nav>
  </header>`;
}

function errorBox() {
  return state.error ? `<div class="error-box" role="alert" tabindex="-1"><strong>这一步没有完成</strong><p>${esc(state.error)}</p></div>` : '';
}

function loadGiftMenu() {
  if (state.busy || state.badLink) return;
  client?.disconnect();
  client = new McdClient();
  const activeClient = client;
  const config = state.config;
  state.connected = false;
  state.menu = null;
  state.cart = [];
  state.search = '';
  invalidateQuote();
  return task('menu', () => activeClient.getMenu(config), menu => {
    state.menu = menu;
    state.category = -1;
    state.connected = true;
  });
}

function steps(items, active) {
  return `<ol class="steps">${items.map((text, i) => `<li class="${i + 1 === active ? 'active' : i + 1 < active ? 'done' : ''}"><span>${i + 1 < active ? icon('check') : `0${i + 1}`}</span>${text}</li>`).join('')}</ol>`;
}

function authorHero() {
  return `<section class="hero wrap">
    <div class="hero-copy"><div class="eyebrow"><span class="tiny-star">✳</span> GOOD CODE DESERVES GOOD FOOD</div><h1>把一句谢谢，<br>变成<span class="red-underline">一顿麦当劳。</span></h1><p>写代码的人，也要好好吃饭。<br>让喜欢你项目的人，为下一次灵感加个餐。</p><div class="hero-foot"><span class="pill">${icon('github')} 为开源而做</span><span class="quiet">Powered by 麦当劳 MCP</span></div></div>
    <div class="hero-art"><span class="art-note">THANKS FOR<br>THE GREAT CODE!</span><img class="meal-illustration" src="./assets/hero-burger.svg" alt="汉堡、薯条和饮料组成的一份感谢餐"/><span class="art-stamp">MERGE<br><b>& MEAL</b><span>EST. 2026</span></span><span class="art-caption">commit a little kindness ↗</span></div>
  </section>`;
}

function authorPanel() {
  let body;
  if (state.step === 1) {
    body = `<div class="panel-heading"><span class="eyebrow">01 / MAKE IT YOURS</span><h2>给你的项目，留个请客入口。</h2><p>填好项目和收款信息，再选一家你喜欢的餐厅。</p></div>
      <form id="author-connect" class="form-stack">
        <label class="field"><span>GitHub 项目</span><div class="input-icon">${icon('github')}<input name="repo" value="${esc(state.author.repo)}" placeholder="github.com/你的名字/你的项目" required autocomplete="off" spellcheck="false" maxlength="200"/></div></label>
        <label class="field"><span>爱发电用户 ID <a href="https://afdian.com/dashboard/dev" target="_blank" rel="noopener noreferrer">查看我的 ID ${icon('external')}</a></span><input name="afdianId" value="${esc(state.author.afdianId)}" placeholder="开发者页面中的 32 位 user_id" required autocomplete="off" spellcheck="false" maxlength="32"/></label>
        ${errorBox()}<button class="button primary full" ${busyAttr()} type="submit">${pending('connect') ? spinner + '正在连接麦当劳…' : '下一步，选择餐厅 ' + icon('arrow')}</button>
      </form>`;
  } else if (state.step === 2) {
    body = `<div class="panel-heading"><span class="eyebrow">02 / YOUR NEIGHBORHOOD</span><h2>选一家你喜欢的餐厅。</h2><p>赞助者将看到这家餐厅的菜单，用它计算建议金额。</p></div>
      <div class="switch-line"><div class="segmented" role="group" aria-label="就餐方式"><button data-action="be-type" data-value="1" class="${state.author.beType === 1 ? 'active' : ''}" ${busyAttr()}>到店自取</button><button data-action="be-type" data-value="5" class="${state.author.beType === 5 ? 'active' : ''}" ${busyAttr()}>得来速</button></div><button class="text-button" data-action="locate" ${busyAttr()}>${pending('locate') ? spinner : icon('pin')} 使用我的位置</button></div>
      <form id="store-search" class="search-form"><label class="field"><span>城市</span><input name="city" placeholder="例如：上海" value="${esc(state.author.city)}" required maxlength="40"/></label><label class="field"><span>街道、商圈或餐厅</span><input name="keyword" placeholder="例如：人民广场" value="${esc(state.author.keyword)}" required maxlength="80"/></label><button class="button dark" type="submit" ${busyAttr()} aria-label="搜索餐厅">${pending('stores') ? spinner : icon('search')}</button></form>
      ${errorBox()}<div class="store-results">${state.stores.length ? state.stores.map((store, i) => `<button class="store-option ${state.selected === i ? 'selected' : ''}" data-action="select-store" data-index="${i}" ${busyAttr()} aria-pressed="${state.selected === i}"><span class="store-pin">${icon('pin')}</span><span class="store-copy"><strong>${esc(store.storeName)}</strong><small>${esc(store.address || '以餐厅实际营业信息为准')}</small><em>${esc(store.distance || '')}${store.businessStatus === false ? ' · 当前未营业' : ''}</em></span><span class="radio-mark">${state.selected === i ? icon('check') : ''}</span></button>`).join('') : `<div class="empty-state">${icon('pin')}<strong>${state.searched ? '这里还没有找到餐厅' : '从你熟悉的街区开始'}</strong><p>${state.searched ? '换一个地标，或使用当前位置再找找。' : '输入城市和位置关键词，或使用定位查找附近餐厅。'}</p></div>`}</div>
      <div class="form-actions"><button class="text-button" data-action="back-connect" ${busyAttr()}>← 返回修改</button><button class="button primary" data-action="generate" ${state.selected === null || state.busy ? 'disabled' : ''}>生成我的请客链接 ${icon('arrow')}</button></div>`;
  } else {
    const share = createShareUrl(baseUrl(), state.config);
    const markup = createBadgeMarkup(share, badgeUrl());
    body = `<div class="panel-heading"><span class="success-label">${icon('check')} 入口准备好了</span><h2>把小汉堡，放进 README。</h2><p>下一份来自开源社区的感谢，就从这里开始。</p></div>
      <div class="badge-preview"><a href="${esc(share)}" target="_blank" rel="noopener noreferrer"><img src="./assets/badge.svg" alt="Buy me a Big Mac 按钮预览" width="224" height="52"/></a><span>点击预览赞助者看到的页面 ↗</span></div>
      <label class="field"><span>你的专属链接</span><div class="copy-input"><input readonly value="${esc(share)}" aria-label="专属请客链接"/><button class="icon-button" data-action="copy-link" aria-label="复制链接">${icon('copy')}</button></div></label>
      <div class="code-heading"><div class="segmented"><button data-action="code-tab" data-value="markdown" class="${state.codeTab === 'markdown' ? 'active' : ''}">Markdown</button><button data-action="code-tab" data-value="html" class="${state.codeTab === 'html' ? 'active' : ''}">HTML</button></div><button class="text-button" data-action="copy-code">${icon('copy')} 复制代码</button></div><textarea class="code-box" readonly aria-label="README 按钮代码" rows="5">${esc(markup[state.codeTab])}</textarea>
      <div class="form-actions"><button class="text-button" data-action="back-store">← 换一家餐厅</button><a class="button primary" href="${esc(share)}" target="_blank" rel="noopener noreferrer">预览请客页面 ${icon('external')}</a></div>`;
  }
  return `<section class="builder wrap" id="create"><div class="builder-title"><div><span class="eyebrow">FOR THE MAINTAINERS</span><h2>先给好代码，安排一顿好饭。</h2></div><span class="connection-status ${state.connected ? 'online' : ''}"><i></i>${state.connected ? 'MCP 已连接' : '准备连接 MCP'}</span></div>${steps(['设置项目','选择餐厅','分享给社区'], state.step)}<div class="builder-grid"><div class="panel">${body}</div>${authorReceipt()}</div></section>`;
}

function authorReceipt() {
  const store = state.config?.storeName || (state.selected !== null ? state.stores[state.selected]?.storeName : '你喜欢的那家餐厅');
  const repo = state.author.repo || 'your-name / awesome-project';
  return `<aside class="author-aside"><div class="receipt dark-receipt"><div class="receipt-top"><span>OPEN SOURCE, OPEN HEART</span>${icon('heart')}</div><h3>A little thanks.<br>A <em>Big Mac.</em></h3><div class="receipt-rule"></div><dl><div><dt>献给这个项目</dt><dd>${esc(repo)}</dd></div><div><dt>餐厅</dt><dd>${esc(store)}</dd></div><div><dt>心意的去处</dt><dd>作者的爱发电账户 ${icon('arrow')}</dd></div></dl><div class="receipt-rule"></div><p class="receipt-note">“谢谢你让我的代码生活，<br>少一点 bug，多一点可能。”</p><div class="barcode" aria-hidden="true"></div><span class="receipt-bottom">A MEAL FOR YOUR NEXT GREAT IDEA</span></div><p class="aside-note">你专注下一次 commit。<br>把“谢谢”，交给一份好好吃饭的心意。</p></aside>`;
}

function howSection() {
  return `<section class="how wrap" id="how-it-works"><div class="section-rule"><span>从一行代码，到一份心意</span></div><div class="how-grid"><article><span class="how-number">01</span><h3>留一个请客入口</h3><p>作者填好项目，选好餐厅，把专属小汉堡放进项目 README。</p></article><article><span class="how-number">02</span><h3>亲手配一顿饭</h3><p>打开链接就能选餐，由麦当劳 MCP 计算建议金额，再写一句祝福。</p></article><article><span class="how-number">03</span><h3>把感谢送到</h3><p>通过爱发电完成赞助。作者自己决定什么时候，享受这一餐。</p></article></div></section>`;
}

function blessings() {
  return ['谢谢你的开源贡献！这顿我请，记得好好吃饭。','愿你的代码没有 bug，薯条永远热乎。','你的项目帮了大忙，给下一次灵感加个餐！','自定义祝福'];
}

function giftPage() {
  if (state.badLink) return `<main class="wrap invalid-page" id="main"><img src="./assets/mark.svg" alt="" width="80"/><h1>这个请客链接不太对。</h1><p>链接可能不完整或版本不受支持，请向项目作者获取完整链接。</p><a class="button primary" href="#create" data-action="home">创建我的入口 ${icon('arrow')}</a></main>`;
  const c = state.config;
  const owner = c.repo.split('/')[0];
  const project = c.repo.split('/')[1];
  const activeStep = state.quote ? 3 : state.cart.length ? 2 : 1;
  return `<main class="wrap gift-page" id="main"><section class="gift-heading"><div><span class="eyebrow">A SMALL TREAT. A BIG THANK YOU.</span><h1>给 <span>${esc(owner)}</span>，加个餐。</h1><p>因为 <a href="https://github.com/${esc(c.repo)}" target="_blank" rel="noopener noreferrer">${icon('github')}${esc(project)} ${icon('external')}</a>，今天的代码生活变好了一点。</p><div class="store-pill">${icon('pin')}${esc(c.storeName)}<span>${c.beType === 5 ? '得来速' : '到店自取'}</span></div></div><img src="./assets/hero-burger.svg" alt="送给作者的一份麦当劳心意"/></section>
  ${steps(['挑选这一餐','计算建议金额','送上心意'], activeStep)}
  <div class="gift-grid"><section class="menu-area">${state.menu ? menuView() : `<div class="panel connect-panel"><div class="connect-symbol">${icon('heart')}</div><div class="panel-heading"><span class="eyebrow">YOUR TREAT, THEIR NEXT IDEA</span><h2>${state.error ? '菜单暂时没准备好。' : '好吃的，正在路上。'}</h2><p>正在通过麦当劳 MCP，读取这家餐厅的菜单。</p></div>${errorBox()}<button type="button" data-action="load-menu" class="button primary full" ${busyAttr()}>${pending('menu') ? spinner + '正在读取菜单…' : '重新加载菜单 ' + icon('arrow')}</button></div>`}</section>${giftReceipt()}</div></main>`;
}

function menuView() {
  const tabs = [{ name: '全部', index: -1 }, ...state.menu.categories.map((category, index) => ({ name: category.name === '全部' ? '全部（餐厅分类）' : category.name, index }))];
  return `<div class="menu-top"><div><span class="eyebrow">FRESH FROM THE MCP</span><h2>你来选，作者慢慢享用。</h2></div><button class="text-button" data-action="reconnect" ${busyAttr()}>刷新菜单</button></div><div class="input-icon menu-search">${icon('search')}<input type="search" id="meal-search" value="${esc(state.search)}" placeholder="找找汉堡、薯条、可乐…" aria-label="搜索餐品"/></div><div class="categories" role="group" aria-label="餐品分类">${tabs.map(({name,index})=>`<button class="${state.category===index?'active':''}" data-action="category" data-index="${index}" aria-pressed="${state.category===index}">${esc(name)}</button>`).join('')}</div><div id="product-grid" class="product-grid">${productCards()}</div><p class="menu-footnote">菜单和建议金额由麦当劳 MCP 查询，优惠以本站查询账号为准，实际购买价格可能不同。本站不向餐厅下单。</p>`;
}

function productCards() {
  const category = state.menu.categories[state.category];
  const products = state.menu.products.filter(p=>(state.category===-1||category?.codes.includes(p.code))&&p.name.toLowerCase().includes(state.search.toLowerCase()));
  if (!products.length) return '<div class="empty-state no-products"><strong>暂时没有匹配的餐品</strong><p>试试其他关键词或分类。</p></div>';
  return products.map(p=>{
    const quantity = state.cart.find(c=>c.code===p.code)?.quantity || 0;
    const image = safeHttpsUrl(p.image) || './assets/food-placeholder.svg';
    return `<article class="product-card ${quantity ? 'in-cart' : ''}"><div class="product-image"><img src="${esc(image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer"/>${quantity?`<span class="quantity-flag">已选 ${quantity}</span>`:''}</div><div class="product-content"><h3>${esc(p.name)}</h3>${p.discountType?`<span class="product-tag">${esc(p.discountType)}</span>`:'<span class="product-tag subtle">一份小小的心意</span>'}<div class="product-bottom"><span class="product-price"><small>¥</small>${formatMoney(p.originalPriceCents ?? p.priceCents)}</span><button class="add-button" data-action="add" data-code="${esc(p.code)}" aria-label="添加${esc(p.name)}" ${state.busy || quantity>=20?'disabled':''}>${icon('plus')}</button></div></div></article>`;
  }).join('');
}

function giftReceipt() {
  const c = state.config;
  const count = state.cart.reduce((n,i)=>n+i.quantity,0);
  return `<aside class="gift-aside"><div class="receipt gift-receipt"><div class="receipt-top"><span>YOUR LITTLE THANK-YOU</span>${icon('heart')}</div><h2>这一餐，我请。</h2><div class="receipt-rule"></div><div class="cart-lines">${state.cart.length ? state.cart.map(item=>`<div class="cart-line"><span>${esc(item.name)}</span><div class="quantity-control"><button data-action="remove" data-code="${esc(item.code)}" aria-label="减少${esc(item.name)}" ${busyAttr()}>${icon('minus')}</button><b>${item.quantity}</b><button data-action="add" data-code="${esc(item.code)}" aria-label="增加${esc(item.name)}" ${item.quantity>=20||state.busy?'disabled':''}>${icon('plus')}</button></div></div>`).join('') : '<div class="empty-cart"><img src="./assets/food-placeholder.svg" alt=""/><p>装一点感谢，<br>再加一点好吃的。</p></div>'}</div><div class="receipt-rule"></div>
    <div class="amount-row"><span>建议金额 <small>${count} 件餐品</small></span><strong>${state.quote?`<small>¥</small>${formatMoney(state.quote.amountCents)}`:'<span class="amount-placeholder">待计算</span>'}</strong></div>
    ${state.quote?`<p class="quote-note">${icon('check')} MCP 已计算 · ${new Date(state.quotedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}<button data-action="quote" class="text-button" ${busyAttr()}>重新计算</button></p>`:`<button class="button ${count?'dark':'outline'} full" data-action="quote" ${!count||state.busy?'disabled':''}>${pending('quote')?spinner+'正在计算…':'计算建议金额 '+icon('arrow')}</button>`}
    ${state.menu ? errorBox() : ''}
    <div class="blessing-section"><label class="receipt-label" for="blessing-select">给作者留句话</label><select id="blessing-select" ${busyAttr()}>${blessings().map((b,i)=>`<option value="${i}" ${state.blessing===i?'selected':''}>${esc(b)}</option>`).join('')}</select>${state.blessing===3?`<textarea id="custom-blessing" placeholder="写下你想说的谢谢…" maxlength="300" rows="3">${esc(state.customBlessing)}</textarea>`:`<p class="blessing-preview">“${esc(blessings()[state.blessing])}”</p>`}</div>
    <button class="button primary full" data-action="pay" ${!state.quote||state.busy?'disabled':''}>去爱发电送出心意 ${icon('external')}</button><p class="payment-note">微信 / 支付宝 · 跳转后确认付款</p><div class="recipient"><span>收款作者</span><code title="${esc(c.afdianId)}">${esc(c.afdianId.slice(0,8))}…${esc(c.afdianId.slice(-6))}</code></div></div><p class="aside-note">这份心意通过爱发电送给作者。<br>餐厅和价格供参考，作者自行安排用餐。</p></aside>`;
}

function footer() {
  return `<footer class="footer wrap"><span>Made for open source. <b>With a side of fries.</b></span><a href="https://github.com/M-China/mcd-developer-innovation-challenge" target="_blank" rel="noopener noreferrer">麦当劳 MCP 开发者挑战作品 ${icon('external')}</a></footer>`;
}

function render() {
  const focused = document.activeElement?.id;
  app.innerHTML = header() + (state.role === 'author' ? `<main id="main">${authorHero()}${authorPanel()}${howSection()}</main>` : giftPage()) + footer();
  if(focused) document.getElementById(focused)?.focus({preventScroll:true});
  document.querySelectorAll('.product-image img').forEach(img=>img.addEventListener('error',()=>{img.src='./assets/food-placeholder.svg';},{once:true}));
}

function invalidateQuote() { state.quote = null; state.quotedAt = 0; }

function selectedConfig() {
  const store = state.stores[state.selected];
  if (!store) throw new Error('请先选择一家餐厅。');
  return normalizeConfig({ v:1, repo:state.author.repo, afdianId:state.author.afdianId, storeCode:String(store.storeCode), beCode:String(store.beCode || ''), storeName:store.storeName, beType:state.author.beType, orderType:1 });
}

function commitStores(raw) {
  if (!Array.isArray(raw)) throw new Error('餐厅数据格式暂不支持，请稍后重试。');
  state.stores = raw.filter(s=>s && s.storeCode && typeof s.storeName === 'string');
  state.searched = true;
  state.selected = null;
}

app.addEventListener('submit', (event)=>{
  event.preventDefault();
  if (state.busy) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  if(form.id==='author-connect') {
    try { state.author.repo=parseGithubRepo(values.repo); state.author.afdianId=validateAfdianId(values.afdianId); }
    catch(error) {state.error=error.message;render();return;}
    client?.disconnect();client=new McdClient();
    const activeClient = client;
    task('connect', ()=>activeClient.connect(), ()=>{state.connected=true;state.step=2;document.querySelector('#create')?.scrollIntoView({behavior:'smooth',block:'start'});});
  } else if (form.id==='store-search') {
    state.author.city=String(values.city).trim();state.author.keyword=String(values.keyword).trim();
    task('stores', ()=>client.searchStores({city:state.author.city,keyword:state.author.keyword,beType:state.author.beType}), commitStores);
  }
});

app.addEventListener('input', (event)=>{
  const el=event.target;
  if(el.id==='meal-search') {state.search=el.value;document.querySelector('#product-grid').innerHTML=productCards();document.querySelectorAll('.product-image img').forEach(img=>img.addEventListener('error',()=>{img.src='./assets/food-placeholder.svg';},{once:true}));}
  if(el.id==='custom-blessing') state.customBlessing=el.value;
  if(state.role==='author'&&el.name&&Object.hasOwn(state.author,el.name)) state.author[el.name]=el.value;
});

app.addEventListener('change', (event)=>{
  if(event.target.id==='blessing-select') {state.blessing=Number(event.target.value);render();if(state.blessing===3)document.querySelector('#custom-blessing')?.focus();}
});

app.addEventListener('click', async(event)=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action;
  if(action==='home') {event.preventDefault();if(location.hash!=='#create'){location.hash='#create';}else{reset();}window.scrollTo({top:0,behavior:'smooth'});return;}
  if(action==='how') {event.preventDefault();if(state.role==='author'){document.querySelector('#how-it-works')?.scrollIntoView({behavior:'smooth'});}else{toast('选餐 → 计算建议金额 → 爱发电送上心意。');}return;}
  if(state.busy)return;
  if(action==='be-type') {state.author.beType=Number(button.dataset.value);state.stores=[];state.selected=null;state.searched=false;render();}
  if(action==='locate') {
    if(!navigator.geolocation){state.error='当前浏览器不支持定位，请使用城市和关键词搜索。';render();return;}
    const activeClient=client, beType=state.author.beType;
    task('locate',async()=>{const p=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,()=>reject(new Error('未能获取位置。请允许定位，或使用城市和关键词搜索。')),{timeout:12000,maximumAge:60000}));return activeClient.searchStores({latitude:p.coords.latitude,longitude:p.coords.longitude,beType});},commitStores);
  }
  if(action==='select-store'){state.selected=Number(button.dataset.index);state.error='';render();}
  if(action==='back-connect'){client?.disconnect();state.connected=false;state.step=1;state.error='';render();}
  if(action==='back-store'){state.step=2;render();}
  if(action==='generate'){try{state.config=selectedConfig();state.step=3;state.error='';render();document.querySelector('#create')?.scrollIntoView({behavior:'smooth'});}catch(e){state.error=e.message;render();}}
  if(action==='code-tab'){state.codeTab=button.dataset.value;render();}
  if(action==='copy-link'||action==='copy-code') {
    const share=createShareUrl(baseUrl(),state.config);
    const value=action==='copy-link'?share:createBadgeMarkup(share,badgeUrl())[state.codeTab];
    try{await navigator.clipboard.writeText(value);toast(action==='copy-link'?'请客链接已复制':'README 按钮代码已复制');}catch{toast('浏览器未允许复制，请选中文本后手动复制。');document.querySelector(action==='copy-link'?'.copy-input input':'.code-box')?.select();}
  }
  if(action==='category'){const index=Number(button.dataset.index);if(Number.isInteger(index)&&index>=-1&&index<state.menu.categories.length){state.category=index;render();}}
  if(action==='reconnect'||action==='load-menu'){void loadGiftMenu();}
  if(action==='add'||action==='remove') {
    const product=state.menu?.products.find(p=>p.code===button.dataset.code);if(!product)return;
    const item=state.cart.find(p=>p.code===product.code);
    if(action==='add') {if(item){item.quantity=Math.min(20,item.quantity+1);}else if(state.cart.length<30){state.cart.push({code:product.code,name:product.name,quantity:1});}else{toast('每次最多选择 30 种餐品。');return;}}
    else if(item){item.quantity--;state.cart=state.cart.filter(p=>p.quantity>0);}
    invalidateQuote();state.error='';render();
  }
  if(action==='quote') {
    if(!state.cart.length||!state.connected)return;
    invalidateQuote();
    const items=state.cart.map(p=>({productCode:p.code,quantity:p.quantity}));
    task('quote',async()=>{
      const quote=await client.calculate(state.config,items);
      const returned=new Map();
      for(const item of quote.items) returned.set(item.code,(returned.get(item.code)||0)+item.quantity);
      if(returned.size!==items.length||items.some(item=>returned.get(item.productCode)!==item.quantity)) {
        throw new Error('餐厅返回的餐品或数量与所选内容不一致，请重新选择餐品后计算。');
      }
      return quote;
    },quote=>{state.quote=quote;state.quotedAt=Date.now();});
  }
  if(action==='pay') {
    if(!state.quote)return;
    if(Date.now()-state.quotedAt>5*60*1000){invalidateQuote();state.error='这份报价已经超过 5 分钟，请重新计算建议金额。';render();return;}
    const blessing=state.blessing===3?state.customBlessing.trim():blessings()[state.blessing];
    if(!blessing){state.error='给作者留一句祝福再出发吧。';render();document.querySelector('#custom-blessing')?.focus();return;}
    const remark=`${blessing}\n项目：${state.config.repo}\n这一餐：${state.cart.map(p=>`${p.name} ×${p.quantity}`).join('、')}\n参考餐厅：${state.config.storeName}\n建议金额：¥${formatMoney(state.quote.amountCents)}\n— Buy me a Big Mac`;
    try {
      const url=buildAfdianUrl({afdianId:state.config.afdianId,amountCents:state.quote.amountCents,remark});
      location.assign(url);
    } catch(error){state.error=error.message;render();}
  }
});

window.addEventListener('hashchange',reset);
window.addEventListener('pagehide',()=>{epoch++;client?.disconnect();});
window.addEventListener('pageshow',event=>{if(event.persisted)reset();});
reset();

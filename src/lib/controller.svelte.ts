import { tick } from 'svelte';
import { McdClient } from './mcp.js';
import { demoConfig, createPreviewClient } from './preview.js';
import { parseGithubRepo, validateAfdianId, normalizeConfig, decodeConfig, createShareUrl, createBadgeMarkup, buildAfdianUrl, formatMoney } from './domain.js';
import { BLESSINGS } from './constants';
import { PaymentsClient } from './payments.js';
import { saveReceipt, readReceipt, readRecentReceipt, deleteReceipt } from './payment-storage.js';
import type { AppController, AppState, Menu, Quote, ShareConfig, Store, PaymentReceipt } from './types';

export interface PaymentGateway {
  createIntent(input: { integrationId: string; afdianId: string; amountCents: number }): Promise<{ intentId: string; readToken: string; expiresAt: number }>;
  status(intentId: string, readToken: string): Promise<{ status: 'pending' | 'notified' | 'unknown'; expiresAt?: number; amountCents?: number; receivedAt?: number }>;
  disconnect(): void;
}

export interface Gateway {
  connect(): Promise<unknown>;
  searchStores(query: { city?: string; keyword?: string; beType: number; latitude?: number; longitude?: number }): Promise<Store[]>;
  getMenu(config: ShareConfig): Promise<Menu>;
  calculate(config: ShareConfig, items: { productCode: string; quantity: number }[]): Promise<Quote>;
  disconnect(): void;
}

function initialState(): AppState {
  return {
    preview: false, role: 'author', step: 1, connected: false, busy: '', error: '',
    config: null, badLink: false,
    author: { repo: '', afdianId: '', city: '', keyword: '', beType: 1 },
    stores: [], searched: false, selected: null, menu: null, category: -1,
    search: '', cart: [], quote: null, quotedAt: 0, quoteStatus: 'idle',
    confirmed: false, celebrationId: 0,
    customBlessing: BLESSINGS[Math.floor(Math.random() * BLESSINGS.length)], codeTab: 'markdown',
    receipt: null, paymentStatus: 'missing', paymentBusy: false, paymentError: '', paymentFallback: false, recentReceiptId: null,
  };
}

export function createAppController(options: {
  createClient?: (preview: boolean) => Gateway;
  debounceMs?: number;
  createPaymentClient?: () => PaymentGateway;
  pollingMs?: number;
} = {}): AppController {
  let state = $state<AppState>(initialState());
  let toastMessage = $state('');
  let epoch = 0;
  let quoteVersion = 0;
  let client: Gateway | null = null;
  let quoteClient: Gateway | null = null;
  let quoteTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let paymentTimer: ReturnType<typeof setTimeout> | undefined;
  let paymentClient: PaymentGateway | null = null;
  let checkoutClient: PaymentGateway | null = null;
  let paymentVersion = 0;
  const celebratedReceipts = new Set<string>();
  const createPaymentClient = options.createPaymentClient ?? (() => new PaymentsClient() as PaymentGateway);
  const createClient = options.createClient ?? ((preview: boolean) =>
    (preview ? createPreviewClient() : new McdClient()) as Gateway);
  const baseUrl = () => new URL(location.pathname, location.origin).toString();
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : '暂时无法完成，请稍后重试。';

  function notify(message: string) {
    clearTimeout(toastTimer);
    toastMessage = message;
    toastTimer = setTimeout(() => { toastMessage = ''; }, 3200);
  }

  async function focusError() {
    await tick();
    if (typeof document !== 'undefined') document.querySelector<HTMLElement>('.error-box')?.focus();
  }

  function stopQuote() {
    quoteVersion++;
    clearTimeout(quoteTimer);
    quoteTimer = undefined;
    quoteClient?.disconnect();
    quoteClient = null;
  }

  function invalidateQuote() {
    stopQuote();
    state.quote = null;
    state.quotedAt = 0;
    state.quoteStatus = 'idle';
    state.confirmed = false;
    state.paymentFallback = false;
  }

  async function task<T>(key: string, work: () => Promise<T>, commit: (result: T) => void) {
    if (state.busy) return;
    const current = epoch;
    state.busy = key;
    state.error = '';
    try {
      const result = await work();
      if (current === epoch) commit(result);
    } catch (error) {
      if (current === epoch) state.error = errorMessage(error);
    } finally {
      if (current === epoch) {
        state.busy = '';
        if (state.error) void focusError();
      }
    }
  }

  function reset() {
    epoch++;
    client?.disconnect();
    client = null;
    stopQuote();
    stopPaymentQuery();
    checkoutClient?.disconnect();
    checkoutClient = null;
    clearTimeout(toastTimer);
    toastMessage = '';
    state = initialState();
    state.recentReceiptId = readRecentReceipt()?.intentId || null;
    const hash = location.hash;
    state.preview = hash.startsWith('#/preview');
    if (hash === '#/preview/thanks') {
      state.role = 'payment';
      state.receipt = { intentId: '0'.repeat(32), readToken: '0'.repeat(64), expiresAt: Date.now() + 300_000,
        createdAt: Date.now(), config: { ...demoConfig } as ShareConfig, items: [{ code: 'demo', name: '巨无霸与薯条', quantity: 1 }], amountCents: 3900, blessing: BLESSINGS[0] };
      state.paymentStatus = 'notified';
    } else if (/^#\/thanks\/[0-9a-f]{32}$/.test(hash)) {
      state.role = 'payment';
      state.receipt = readReceipt(hash.slice('#/thanks/'.length)) as PaymentReceipt | null;
      state.paymentStatus = state.receipt ? 'pending' : 'missing';
      if (state.receipt) void checkPayment();
    } else if (hash === '#/preview' || hash === '#/preview/') {
      state.role = 'gift';
      state.config = { ...demoConfig } as ShareConfig;
    } else if (hash.startsWith('#/preview/gift/') || hash.startsWith('#/gift/')) {
      state.role = 'gift';
      const prefix = state.preview ? '#/preview/gift/' : '#/gift/';
      try { state.config = decodeConfig(hash.slice(prefix.length)) as ShareConfig; }
      catch { state.badLink = true; }
    } else if (hash === '#/preview/create') {
      state.author = { ...state.author, repo: demoConfig.repo, afdianId: demoConfig.afdianId, city: '上海', keyword: '人民广场' };
    } else if (hash && hash !== '#create' && hash !== '#how-it-works') {
      state.badLink = true;
      state.role = 'gift';
    }
    if (state.role === 'gift' && !state.badLink) void loadGiftMenu();
  }

  async function loadGiftMenu() {
    if (state.busy || state.badLink || !state.config) return;
    client?.disconnect();
    client = createClient(state.preview);
    const activeClient = client;
    const config = state.config;
    state.connected = false;
    state.menu = null;
    state.cart = [];
    state.search = '';
    invalidateQuote();
    await task('menu', () => activeClient.getMenu(config), menu => {
      state.menu = menu;
      state.category = -1;
      state.connected = true;
    });
  }

  function commitStores(stores: Store[]) {
    if (!Array.isArray(stores)) throw new Error('餐厅数据格式暂不支持，请稍后重试。');
    state.stores = stores.filter(store => store && store.storeCode && typeof store.storeName === 'string');
    state.searched = true;
    state.selected = null;
  }

  async function connectAuthor() {
    if (state.busy) return;
    try {
      state.author.repo = parseGithubRepo(state.author.repo);
      state.author.afdianId = validateAfdianId(state.author.afdianId);
    } catch (error) { state.error = errorMessage(error); void focusError(); return; }
    client?.disconnect();
    client = createClient(state.preview);
    const activeClient = client;
    await task('connect', () => activeClient.connect(), () => {
      state.connected = true;
      state.step = 2;
      scrollTo('create');
    });
  }

  async function searchStores() {
    if (!client) return;
    state.author.city = state.author.city.trim();
    state.author.keyword = state.author.keyword.trim();
    const activeClient = client;
    await task('stores', () => activeClient.searchStores({ city: state.author.city, keyword: state.author.keyword, beType: state.author.beType }), commitStores);
  }

  async function locate() {
    if (!client || state.busy) return;
    const activeClient = client;
    const beType = state.author.beType;
    if (state.preview) { await task('locate', () => activeClient.searchStores({ beType }), commitStores); return; }
    if (!navigator.geolocation) { state.error = '当前浏览器不支持定位，请使用城市和关键词搜索。'; void focusError(); return; }
    await task('locate', async () => {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve,
        () => reject(new Error('未能获取位置。请允许定位，或使用城市和关键词搜索。')), { timeout: 12000, maximumAge: 60000 }));
      return activeClient.searchStores({ latitude: position.coords.latitude, longitude: position.coords.longitude, beType });
    }, commitStores);
  }

  function scrollTo(id: string) {
    void tick().then(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function shareUrl() {
    if (!state.config) return '';
    const share = createShareUrl(baseUrl(), state.config);
    return state.preview ? share.replace('#/gift/', '#/preview/gift/') : share;
  }

  function badgeMarkup() {
    return state.config ? createBadgeMarkup(shareUrl(), new URL('./assets/badge.svg', baseUrl()).toString()) : { markdown: '', html: '' };
  }

  function generateLink() {
    if (state.busy) return;
    try {
      const store = state.selected === null ? null : state.stores[state.selected];
      if (!store) throw new Error('请先选择一家餐厅。');
      state.config = normalizeConfig({ v: 1, repo: state.author.repo, afdianId: state.author.afdianId,
        storeCode: String(store.storeCode), beCode: String(store.beCode || ''), storeName: store.storeName,
        beType: state.author.beType, orderType: 1 }) as ShareConfig;
      state.step = 3;
      state.error = '';
      state.celebrationId++;
      scrollTo('create');
    } catch (error) { state.error = errorMessage(error); void focusError(); }
  }

  async function copy(which: 'link' | 'code') {
    const value = which === 'link' ? shareUrl() : badgeMarkup()[state.codeTab];
    try {
      await navigator.clipboard.writeText(value);
      notify(which === 'link' ? '请客链接已复制' : 'README 按钮代码已复制');
    } catch {
      notify('浏览器未允许复制，请选中文本后手动复制。');
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>(which === 'link' ? '.copy-input input' : '.code-box')?.select();
    }
  }

  function scheduleQuote() {
    if (!state.cart.length || !state.connected) return;
    state.quoteStatus = 'scheduled';
    quoteTimer = setTimeout(() => { quoteTimer = undefined; void quote(); }, options.debounceMs ?? 350);
  }

  function changeQuantity(code: string, delta: 1 | -1) {
    if (state.busy) return;
    const product = state.menu?.products.find(item => item.code === code);
    if (!product) return;
    const item = state.cart.find(item => item.code === code);
    if (delta === 1) {
      if (item) {
        if (item.quantity >= 20) return;
        item.quantity++;
      } else if (state.cart.length < 30) state.cart.push({ code, name: product.name, quantity: 1 });
      else { notify('每次最多选择 30 种餐品。'); return; }
    } else if (item) {
      item.quantity--;
      state.cart = state.cart.filter(item => item.quantity > 0);
    } else return;
    invalidateQuote();
    state.error = '';
    scheduleQuote();
  }

  async function quote() {
    if (!state.cart.length || !state.connected || !state.config || state.busy) return;
    stopQuote();
    const version = quoteVersion;
    const currentEpoch = epoch;
    const config = state.config;
    const items = state.cart.map(item => ({ productCode: item.code, quantity: item.quantity }));
    const activeClient = createClient(state.preview);
    quoteClient = activeClient;
    state.quote = null;
    state.quotedAt = 0;
    state.quoteStatus = 'loading';
    state.confirmed = false;
    state.error = '';
    try {
      const result = await activeClient.calculate(config, items);
      if (currentEpoch !== epoch || version !== quoteVersion) return;
      const returned = new Map<string, number>();
      for (const item of result.items) returned.set(item.code, (returned.get(item.code) || 0) + item.quantity);
      if (returned.size !== items.length || items.some(item => returned.get(item.productCode) !== item.quantity)) {
        throw new Error('餐厅返回的餐品或数量与所选内容不一致，请重新选择餐品后计算。');
      }
      state.quote = result;
      state.quotedAt = Date.now();
      state.quoteStatus = 'idle';
    } catch (error) {
      if (currentEpoch === epoch && version === quoteVersion) {
        state.error = errorMessage(error);
        state.quoteStatus = 'error';
      }
    } finally {
      activeClient.disconnect();
      if (quoteClient === activeClient) quoteClient = null;
    }
  }

  function currentQuote() {
    if (!state.quote || state.quoteStatus !== 'idle') return false;
    if (Date.now() - state.quotedAt > 5 * 60 * 1000) {
      invalidateQuote();
      scheduleQuote();
      notify('正在更新这份餐单的建议金额，请稍等。');
      return false;
    }
    return true;
  }

  function confirmMeal() {
    if (state.busy || state.confirmed || !state.cart.length || !currentQuote()) return;
    state.confirmed = true;
  }

  function donationRemark(config: ShareConfig, items: { name: string; quantity: number }[], amountCents: number, blessing: string) {
    return [blessing, `项目：${config.repo}`, `这一餐：${items.map(item => `${item.name} ×${item.quantity}`).join('、')}`,
      `参考餐厅：${config.storeName}`, `建议金额：¥${formatMoney(amountCents)}`, '— Buy me a Big Mac'].join('\n');
  }

  async function pay() {
    if (state.busy || !state.confirmed || !currentQuote() || !state.config || !state.quote) return;
    const blessing = state.customBlessing.trim();
    if (!blessing) {
      state.error = '给作者留一句祝福再出发吧。';
      void tick().then(() => document.getElementById('custom-blessing')?.focus());
      return;
    }
    if (state.preview) { state.error = ''; notify('演示完成！正式使用时会前往爱发电确认赞助。'); return; }
    const config = { ...state.config };
    const amountCents = state.quote.amountCents;
    const items = state.cart.map(item => ({ code: item.code, name: item.name, quantity: item.quantity }));
    const remark = donationRemark(config, items, amountCents, blessing);
    const current = epoch;
    try {
      // Validate the complete checkout link before creating any server state.
      const directUrl = buildAfdianUrl({ afdianId: config.afdianId, amountCents, remark });
      if (!config.integrationId) { location.assign(directUrl); return; }
      state.busy = 'payment';
      state.error = '';
      state.paymentFallback = false;
      checkoutClient = createPaymentClient();
      const intent = await checkoutClient.createIntent({ integrationId: config.integrationId, afdianId: config.afdianId, amountCents });
      if (current !== epoch) return;
      const receipt: PaymentReceipt = { ...intent, createdAt: Date.now(), config, items, amountCents, blessing };
      if (!saveReceipt(receipt)) throw new Error('浏览器未能保存这份心意，暂时无法在返回后查询通知。可重试，或仅前往爱发电。');
      const url = buildAfdianUrl({ afdianId: config.afdianId, amountCents, remark, reference: intent.intentId });
      state.recentReceiptId = intent.intentId;
      // Afdian has no payment return URL. Browser Back lands on our result page;
      // the capability stays in localStorage, never in a URL or payment remark.
      history.replaceState(null, '', `#/thanks/${intent.intentId}`);
      location.assign(url);
    } catch (error) {
      if (current === epoch) {
        state.error = errorMessage(error);
        state.paymentFallback = Boolean(config.integrationId);
        void focusError();
      }
    } finally {
      if (current === epoch) { state.busy = ''; checkoutClient?.disconnect(); checkoutClient = null; }
    }
  }

  function payDirect() {
    if (!state.paymentFallback || state.preview || state.busy || !state.confirmed || !currentQuote() || !state.config || !state.quote) return;
    if (!state.customBlessing.trim()) {
      state.error = '给作者留一句祝福再出发吧。';
      void focusError();
      return;
    }
    try {
      location.assign(buildAfdianUrl({ afdianId: state.config.afdianId, amountCents: state.quote.amountCents,
        remark: donationRemark(state.config, state.cart, state.quote.amountCents, state.customBlessing.trim()) }));
    } catch (error) { state.error = errorMessage(error); void focusError(); }
  }

  function stopPaymentQuery() {
    paymentVersion++;
    clearTimeout(paymentTimer);
    paymentTimer = undefined;
    paymentClient?.disconnect();
    paymentClient = null;
    state.paymentBusy = false;
  }

  function pageVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  async function checkPayment() {
    if (state.preview || state.role !== 'payment' || !state.receipt || state.paymentBusy || !pageVisible() || ['notified', 'unknown'].includes(state.paymentStatus)) return;
    clearTimeout(paymentTimer);
    const receipt = state.receipt;
    // A callback can arrive near the end of the 5-minute intent and remain
    // visible for another 5 minutes. Don't expire it using the pending deadline.
    if (Date.now() >= receipt.createdAt + 600_000) { state.paymentStatus = 'unknown'; return; }
    const current = epoch;
    const version = ++paymentVersion;
    state.paymentBusy = true;
    state.paymentError = '';
    paymentClient?.disconnect();
    const active = createPaymentClient();
    paymentClient = active;
    try {
      const result = await active.status(receipt.intentId, receipt.readToken);
      if (epoch !== current || version !== paymentVersion) return;
      state.paymentStatus = result.status;
      if (result.expiresAt) state.receipt = { ...receipt, expiresAt: result.expiresAt };
      if (result.status === 'notified' && !celebratedReceipts.has(receipt.intentId)) {
        celebratedReceipts.add(receipt.intentId);
        state.celebrationId++;
      }
    } catch (error) {
      if (epoch === current && version === paymentVersion) {
        state.paymentStatus = 'error';
        state.paymentError = errorMessage(error);
      }
    } finally {
      active.disconnect();
      if (epoch === current && version === paymentVersion) {
        state.paymentBusy = false;
        if (state.paymentStatus === 'pending' && pageVisible()) paymentTimer = setTimeout(() => { void checkPayment(); }, options.pollingMs ?? 10_000);
      }
    }
  }

  function paymentUrl() {
    if (!state.receipt || state.preview) return '';
    const r = state.receipt;
    try { return buildAfdianUrl({ afdianId: r.config.afdianId, amountCents: r.amountCents,
      remark: donationRemark(r.config, r.items, r.amountCents, r.blessing), reference: r.intentId }); }
    catch { return ''; }
  }

  function continuePayment() {
    if (state.preview || state.paymentStatus !== 'pending' || state.paymentBusy || !state.receipt) return;
    if (Date.now() >= state.receipt.expiresAt) { state.paymentError = '这份付款关联已过期，请在爱发电查看订单，避免重复赞助。'; return; }
    const url = paymentUrl();
    if (url) location.assign(url);
  }

  function forgetPayment() {
    stopPaymentQuery();
    if (state.receipt && !state.preview) deleteReceipt(state.receipt.intentId);
    state.recentReceiptId = readRecentReceipt()?.intentId || null;
    location.hash = state.preview ? '#/preview/create' : '#create';
  }

  function suspend() {
    epoch++;
    client?.disconnect();
    stopQuote();
    stopPaymentQuery();
    checkoutClient?.disconnect();
    checkoutClient = null;
    clearTimeout(toastTimer);
  }

  return {
    get state() { return state; },
    get toastMessage() { return toastMessage; },
    init() {
      reset();
      const restore = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
      const resumePayment = () => {
        if (!pageVisible()) stopPaymentQuery();
        else void checkPayment();
      };
      window.addEventListener('hashchange', reset);
      window.addEventListener('pagehide', suspend);
      window.addEventListener('pageshow', restore);
      window.addEventListener('focus', resumePayment);
      document.addEventListener('visibilitychange', resumePayment);
      return () => {
        suspend();
        window.removeEventListener('hashchange', reset);
        window.removeEventListener('pagehide', suspend);
        window.removeEventListener('pageshow', restore);
        window.removeEventListener('focus', resumePayment);
        document.removeEventListener('visibilitychange', resumePayment);
      };
    },
    home() {
      if (state.role !== 'author') location.hash = state.preview ? '#/preview/create' : '#create';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    how() {
      if (state.role === 'author') scrollTo('how-it-works');
      else notify('选餐 → 选好了 → 留句祝福，去爱发电送上心意。');
    },
    scrollTo,
    setAuthorField(field, value) { state.author[field] = value; },
    connectAuthor, searchStores, locate,
    setBeType(value) {
      if (state.busy) return;
      state.author.beType = value;
      state.stores = [];
      state.selected = null;
      state.searched = false;
    },
    selectStore(index) {
      if (state.busy || !Number.isInteger(index) || !state.stores[index]) return;
      state.selected = index;
      state.error = '';
    },
    backToProject() {
      if (state.busy) return;
      client?.disconnect();
      state.connected = false;
      state.step = 1;
      state.error = '';
    },
    backToStores() { if (!state.busy) state.step = 2; },
    generateLink,
    setNotificationIntegrationId(id) {
      if (state.role !== 'author' || !state.config) return;
      const { integrationId: _old, ...config } = state.config;
      state.config = normalizeConfig({ ...config, ...(id ? { integrationId: id } : {}) }) as ShareConfig;
    },
    setCodeTab(value) { state.codeTab = value; },
    shareUrl, badgeMarkup, copy,
    setCategory(index) {
      if (state.menu && Number.isInteger(index) && index >= -1 && index < state.menu.categories.length) state.category = index;
    },
    setSearch(value) { state.search = value; },
    changeQuantity, loadGiftMenu, quote,
    setCustomBlessing(value) { state.customBlessing = value; },
    confirmMeal, pay, payDirect, checkPayment, continuePayment, forgetPayment, paymentUrl,
  };
}

import { tick } from 'svelte';
import { McdClient } from './mcp.js';
import { demoConfig, createPreviewClient } from './preview.js';
import { parseGithubRepo, validateSponsorName, validateAfdianId, normalizeConfig, decodeConfig, createShareUrl, createBadgeMarkup, buildAfdianUrl, hasPaymentNotifications } from './domain.js';
import { buildDonationRemark } from './donation-remark.js';
import { BLESSINGS, blessingsFor } from './constants';
import { BADGE_LANGUAGES, DEFAULT_BADGE_LANGUAGE, getBadgeLanguage } from './badges.js';
import { matchRoute, createPath, thanksPath } from './routes.js';
import { PaymentsClient } from './payments.js';
import { saveReceipt, readReceipt, readRecentReceipt, deleteReceipt } from './payment-storage.js';
import { validateStripePaymentLink, buildStripePaymentUrl, parseStripeReturnId } from './stripe.js';
import type { AppController, AppState, Menu, ShareConfig, Store, PaymentReceipt, ReceiptItem } from './types';

export interface PaymentGateway {
  createIntent(input: { afdianId: string; amountCents: number }): Promise<{ intentId: string; readToken: string; expiresAt: number }>;
  status(intentId: string, readToken: string): Promise<{ status: 'pending' | 'notified' | 'unknown'; expiresAt?: number; amountCents?: number; receivedAt?: number; afdianOrderNo?: string }>;
  disconnect(): void;
}

export interface Gateway {
  connect(): Promise<unknown>;
  searchStores(query: { city?: string; keyword?: string; beType: number; latitude?: number; longitude?: number }): Promise<Store[]>;
  getMenu(config: ShareConfig): Promise<Menu>;
  disconnect(): void;
}

function initialState(): AppState {
  return {
    preview: false, role: 'author', step: 1, connected: false, busy: '', error: '',
    config: null, badLink: false,
    author: { sponsorType: 'person', name: '', repo: '', afdianId: '', paymentProvider: 'afdian', stripePaymentLink: '', city: '', keyword: '', beType: 1 },
    stores: [], searched: false, selected: null, menu: null, category: -1,
    search: '', cart: [], quote: null, celebrationId: 0,
    customBlessing: BLESSINGS[0], codeTab: 'markdown', badgeLanguage: DEFAULT_BADGE_LANGUAGE,
    receipt: null, paymentStatus: 'missing', paymentProvider: 'afdian', paymentBusy: false, paymentError: '', paymentFallback: false, recentReceiptId: null,
  };
}

export function createAppController(options: {
  createClient?: (preview: boolean) => Gateway;
  createPaymentClient?: () => PaymentGateway;
  pollingMs?: number;
} = {}): AppController {
  let state = $state<AppState>(initialState());
  let toastMessage = $state('');
  let epoch = 0;
  let client: Gateway | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let paymentTimer: ReturnType<typeof setTimeout> | undefined;
  let paymentClient: PaymentGateway | null = null;
  let checkoutClient: PaymentGateway | null = null;
  let checkoutTab: Window | null = null;
  let paymentVersion = 0;
  let notificationAuthorId: string | null = null;
  const celebratedReceipts = new Set<string>();
  const createPaymentClient = options.createPaymentClient ?? (() => new PaymentsClient() as PaymentGateway);
  const createClient = options.createClient ?? ((preview: boolean) =>
    (preview ? createPreviewClient() : new McdClient()) as Gateway);
  const assetUrl = (path: string) => new URL(path, location.origin).toString();
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
    stopPaymentQuery();
    checkoutClient?.disconnect();
    checkoutClient = null;
    closeCheckoutTab();
    clearTimeout(toastTimer);
    toastMessage = '';
    notificationAuthorId = null;
    state = initialState();
    const recent = readRecentReceipt({ provider: 'afdian' });
    state.recentReceiptId = recent && hasPaymentNotifications(recent.config) ? recent.intentId : null;
    const route = matchRoute(location.pathname);
    state.preview = route.preview;
    state.badgeLanguage = route.language ?? DEFAULT_BADGE_LANGUAGE;
    if (route.page === 'thanks' && route.paymentProvider === 'stripe') {
      state.role = 'payment';
      state.paymentProvider = 'stripe';
      if (route.demo) {
        const { afdianId: _afdianId, ...scene } = demoConfig;
        state.receipt = { provider: 'stripe', intentId: '0'.repeat(32), createdAt: Date.now(),
          config: { ...scene, paymentProvider: 'stripe', stripePaymentLink: 'https://buy.stripe.com/test_ExampleBigMac' } as ShareConfig,
          items: [{ code: 'demo', name: '巨无霸与薯条', quantity: 1, amountCents: 3900 }], amountCents: 3900, blessing: BLESSINGS[0] };
      } else {
        // UTM identifies a local meal snapshot only. It never proves payment.
        const id = parseStripeReturnId(location.search);
        const receipt = id ? readReceipt(id) as PaymentReceipt | null : null;
        state.receipt = receipt?.provider === 'stripe' ? receipt : null;
      }
      state.paymentStatus = state.receipt ? 'returned' : 'missing';
      if (state.receipt && !celebratedReceipts.has(state.receipt.intentId)) {
        celebratedReceipts.add(state.receipt.intentId);
        state.celebrationId++;
      }
    } else if (route.page === 'thanks' && route.demo) {
      state.role = 'payment';
      state.receipt = { intentId: '0'.repeat(32), readToken: '0'.repeat(64), expiresAt: Date.now() + 300_000,
        createdAt: Date.now(), config: { ...demoConfig, notifications: true } as ShareConfig, items: [{ code: 'demo', name: '巨无霸与薯条', quantity: 1, amountCents: 3900 }], amountCents: 3900, blessing: BLESSINGS[0],
        // Example order number only: preview never queries or creates a payment.
        afdianOrderNo: '202610130250001234567890123' };
      state.paymentStatus = 'notified';
      state.celebrationId++;
    } else if (route.page === 'thanks') {
      state.role = 'payment';
      state.receipt = readReceipt(route.receiptId as string) as PaymentReceipt | null;
      if (state.receipt?.provider === 'stripe') state.receipt = null;
      state.paymentStatus = state.receipt ? (hasPaymentNotifications(state.receipt.config) ? 'pending' : 'unknown') : 'missing';
      if (hasPaymentNotifications(state.receipt?.config)) void checkPayment();
    } else if (route.page === 'gift' && route.demo) {
      state.role = 'gift';
      state.config = { ...demoConfig } as ShareConfig;
    } else if (route.page === 'gift') {
      state.role = 'gift';
      try { state.config = decodeConfig(location.search.slice(1)) as ShareConfig; }
      catch { state.badLink = true; }
    } else if (route.page === 'create' && route.preview) {
      state.author = { ...state.author, sponsorType: 'project', name: 'Kairui', repo: demoConfig.repo, afdianId: demoConfig.afdianId, city: '北京', keyword: '朝阳公园' };
    } else if (route.page === 'unknown') {
      state.badLink = true;
      state.role = 'gift';
    }
    if (state.role === 'gift') {
      if (!state.config || !hasPaymentNotifications(state.config) || !recent
        || recent.config.notifications !== state.config.notifications
        || recent.config.afdianId !== state.config.afdianId) state.recentReceiptId = null;
      if (!state.badLink) void loadGiftMenu();
    }
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
    state.quote = null;
    state.paymentFallback = false;
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
    state.connected = true;
  }

  async function connectAuthor() {
    if (state.busy) return;
    try {
      if (state.author.sponsorType === 'person') state.author.name = validateSponsorName(state.author.name);
      else state.author.repo = parseGithubRepo(state.author.repo);
    } catch (error) { state.error = errorMessage(error); void focusError(); return; }
    client?.disconnect();
    client = createClient(state.preview);
    state.connected = false;
    state.error = '';
    state.step = 2;
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
    return createShareUrl(location.origin, state.config,
      { preview: state.preview, language: state.badgeLanguage });
  }

  function badgeMarkup() {
    if (!state.config) return { markdown: '', html: '' };
    const badge = getBadgeLanguage(state.badgeLanguage);
    return createBadgeMarkup(shareUrl(), assetUrl(badge.asset), badge.text);
  }

  function continueToPayment() {
    if (state.busy || state.role !== 'author') return;
    if (state.selected === null || !state.stores[state.selected]) {
      state.error = '请先选择一家餐厅。';
      void focusError();
      return;
    }
    state.error = '';
    state.step = 3;
  }

  function generateLink() {
    if (state.busy || state.role !== 'author' || state.step !== 3) return;
    try {
      const store = state.selected === null ? null : state.stores[state.selected];
      if (!store) throw new Error('请先选择一家餐厅。');
      const identity = state.author.sponsorType === 'person'
        ? { sponsorType: 'person', name: state.author.name } : { repo: state.author.repo };
      const payment = state.author.paymentProvider === 'stripe'
        ? { paymentProvider: 'stripe', stripePaymentLink: validateStripePaymentLink(state.author.stripePaymentLink) }
        : { afdianId: validateAfdianId(state.author.afdianId),
          ...(notificationAuthorId === validateAfdianId(state.author.afdianId) ? { notifications: true } : {}) };
      state.config = normalizeConfig({ v: 1, ...identity, ...payment,
        storeCode: String(store.storeCode),
        beType: state.author.beType, orderType: 1 }) as ShareConfig;
      if (state.config.paymentProvider === 'stripe') state.author.stripePaymentLink = state.config.stripePaymentLink;
      else state.author.afdianId = state.config.afdianId;
      state.step = 4;
      state.error = '';
      state.celebrationId++;
    } catch (error) { state.error = errorMessage(error); void focusError(); }
  }

  async function copy(which: 'link' | 'code') {
    const value = which === 'link' ? shareUrl() : badgeMarkup()[state.codeTab];
    try {
      await navigator.clipboard.writeText(value);
      notify(which === 'link' ? '赞助链接已复制' : 'README 按钮代码已复制');
    } catch {
      notify('浏览器未允许复制，请选中文本后手动复制。');
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>(which === 'link' ? '.copy-input input' : '.code-box')?.select();
    }
  }

  function updateQuote() {
    state.quote = null;
    if (!state.cart.length || !state.menu || !state.connected) return;
    try {
      const items = state.cart.map(item => {
        const product = state.menu?.products.find(product => product.code === item.code);
        if (!product || !Number.isSafeInteger(product.priceCents) || product.priceCents < 0
          || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
          throw new Error('餐品价格暂不可用，请移除该餐品后重试。');
        }
        const amountCents = product.priceCents * item.quantity;
        const originalPrice = Number.isSafeInteger(product.originalPriceCents)
          && (product.originalPriceCents as number) >= product.priceCents
          ? product.originalPriceCents as number : product.priceCents;
        return { ...item, amountCents, originalCents: originalPrice * item.quantity };
      });
      const amountCents = items.reduce((sum, item) => sum + item.amountCents, 0);
      const originalCents = items.reduce((sum, item) => sum + item.originalCents, 0);
      if (!Number.isSafeInteger(amountCents) || amountCents > 3_000_000 || !Number.isSafeInteger(originalCents)) {
        throw new Error('赞助金额不能超过 ¥30,000，请减少餐品数量。');
      }
      // All arithmetic uses the menu prices already displayed, in integer cents.
      // A zero-total cart cannot open a payment, but can still be edited normally.
      if (amountCents > 0) state.quote = { items, amountCents, originalCents, discountCents: originalCents - amountCents };
    } catch (error) { state.error = errorMessage(error); }
  }

  function changeQuantity(code: string, delta: 1 | -1) {
    if (state.busy || !state.connected) return;
    const product = state.menu?.products.find(item => item.code === code);
    if (!product) return;
    if (delta === 1 && (!Number.isSafeInteger(product.priceCents) || product.priceCents < 0)) {
      state.error = '餐品价格暂不可用，请选择其他餐品。';
      return;
    }
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
    state.error = '';
    state.paymentFallback = false;
    updateQuote();
  }

  function donationRemark(config: ShareConfig, items: ReceiptItem[], amountCents: number, blessing: string) {
    const recipient = config.sponsorType === 'person' ? config.name : config.repo;
    return buildDonationRemark({ recipient, items, amountCents, blessing });
  }

  function openPaymentTab(url?: string): Window {
    // Reserve the tab during the click, before any asynchronous intent request.
    const tab = window.open('about:blank', '_blank');
    if (!tab) throw new Error('浏览器拦截了新标签页，请允许本站打开新标签页后重试。');
    try {
      tab.opener = null;
      if (url) tab.location.replace(url);
      return tab;
    } catch (error) {
      tab.close();
      throw error;
    }
  }

  function closeCheckoutTab() {
    checkoutTab?.close();
    checkoutTab = null;
  }

  async function pay() {
    if (state.busy || !state.config || !state.cart.length) return;
    updateQuote();
    if (!state.quote) return;
    const blessing = state.customBlessing.trim();
    if (state.preview) {
      state.error = '';
      notify(state.config.paymentProvider === 'stripe'
        ? '演示完成! 正式使用时会前往 Stripe, 付款后返回本站.'
        : '演示完成！正式使用时会在新标签页打开爱发电确认赞助。');
      return;
    }
    const config = { ...state.config };
    const amountCents = state.quote.amountCents;
    const items = state.quote.items.map(({ code, name, quantity, amountCents }) => ({ code, name, quantity, amountCents }));
    const current = epoch;
    let tab: Window | null = null;
    try {
      if (config.paymentProvider === 'stripe') {
        const intentId = crypto.randomUUID().replaceAll('-', '');
        const url = buildStripePaymentUrl({ paymentLink: config.stripePaymentLink, amountCents, receiptId: intentId });
        const receipt: PaymentReceipt = { provider: 'stripe', intentId, createdAt: Date.now(), config, items, amountCents, blessing };
        if (!saveReceipt(receipt)) throw new Error('浏览器未能保存小票, 请允许本站使用本地存储后重试.');
        state.busy = 'payment';
        state.error = '';
        // Stay in this browser so Stripe's configured redirect can restore the
        // same local receipt. No API call, webhook or payment-state record.
        location.assign(url);
        return;
      }
      // Validate the complete checkout link before creating any server state.
      const remark = donationRemark(config, items, amountCents, blessing);
      const directUrl = buildAfdianUrl({ afdianId: config.afdianId, amountCents, remark });
      if (!hasPaymentNotifications(config)) { openPaymentTab(directUrl); state.error = ''; return; }
      tab = openPaymentTab();
      checkoutTab = tab;
      state.busy = 'payment';
      state.error = '';
      state.paymentFallback = false;
      checkoutClient = createPaymentClient();
      const intent = await checkoutClient.createIntent({ afdianId: config.afdianId, amountCents });
      if (current !== epoch) return;
      const receipt: PaymentReceipt = { ...intent, createdAt: Date.now(), config, items, amountCents, blessing };
      if (!saveReceipt(receipt)) throw new Error('浏览器未能保存这份心意，暂时无法在返回后查询通知。可重试，或仅前往爱发电。');
      const url = buildAfdianUrl({ afdianId: config.afdianId, amountCents, remark, reference: intent.intentId });
      // Keep the receipt in this tab; only the public reference goes to Afdian.
      history.replaceState(null, '', thanksPath(intent.intentId));
      let openingError = '';
      if (tab.closed) {
        openingError = '付款标签页已关闭。请点击“未完成付款，继续前往爱发电”重新打开。';
      } else {
        try { tab.location.replace(url); }
        catch {
          tab.close();
          openingError = '未能打开爱发电。请点击“未完成付款，继续前往爱发电”重试。';
        }
      }
      checkoutTab = null;
      tab = null;
      // replaceState does not emit popstate, so render the receipt explicitly.
      reset();
      state.paymentError = openingError;
    } catch (error) {
      if (current === epoch) {
        state.error = errorMessage(error);
        state.paymentFallback = hasPaymentNotifications(config);
        void focusError();
      }
    } finally {
      if (tab) {
        tab.close();
        if (checkoutTab === tab) checkoutTab = null;
      }
      if (current === epoch) { state.busy = ''; checkoutClient?.disconnect(); checkoutClient = null; }
    }
  }

  function payDirect() {
    if (!state.paymentFallback || state.preview || state.busy || !state.config || state.config.paymentProvider === 'stripe' || !state.cart.length) return;
    updateQuote();
    if (!state.quote) return;
    try {
      openPaymentTab(buildAfdianUrl({ afdianId: state.config.afdianId, amountCents: state.quote.amountCents,
        remark: donationRemark(state.config, state.quote.items, state.quote.amountCents, state.customBlessing.trim()) }));
      state.error = '';
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
    if (state.preview || state.role !== 'payment' || !state.receipt || state.receipt.provider === 'stripe' || !hasPaymentNotifications(state.receipt.config) || state.paymentBusy || !pageVisible() || ['notified', 'unknown'].includes(state.paymentStatus)) return;
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
      if (result.status === 'notified') {
        const { afdianOrderNo: _cachedOrderNo, ...details } = receipt;
        state.receipt = { ...details, expiresAt: result.expiresAt ?? receipt.expiresAt,
          ...(result.afdianOrderNo ? { afdianOrderNo: result.afdianOrderNo } : {}) };
        saveReceipt(state.receipt);
      }
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
    if (!state.receipt || state.receipt.provider === 'stripe' || state.receipt.config.paymentProvider === 'stripe' || !hasPaymentNotifications(state.receipt.config) || state.preview) return '';
    const r = state.receipt;
    try { return buildAfdianUrl({ afdianId: r.config.afdianId, amountCents: r.amountCents,
      remark: donationRemark(r.config, r.items, r.amountCents, r.blessing), reference: r.intentId }); }
    catch { return ''; }
  }

  function continuePayment() {
    if (state.preview || state.paymentStatus !== 'pending' || state.paymentBusy || !state.receipt || state.receipt.provider === 'stripe' || !hasPaymentNotifications(state.receipt.config)) return;
    if (Date.now() >= state.receipt.expiresAt) { state.paymentError = '这份付款关联已过期，请在爱发电查看订单，避免重复赞助。'; return; }
    const url = paymentUrl();
    if (url) {
      try { openPaymentTab(url); state.paymentError = ''; }
      catch (error) { state.paymentError = errorMessage(error); }
    }
  }

  function navigate(path: string) {
    history.pushState(null, '', path);
    reset();
  }

  function forgetPayment() {
    // Navigating re-reads the stored receipts, so drop this one first.
    if (state.receipt && !state.preview) deleteReceipt(state.receipt.intentId);
    navigate(createPath(state.preview));
  }

  function suspend() {
    epoch++;
    client?.disconnect();
    stopPaymentQuery();
    checkoutClient?.disconnect();
    checkoutClient = null;
    closeCheckoutTab();
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
      window.addEventListener('popstate', reset);
      window.addEventListener('pagehide', suspend);
      window.addEventListener('pageshow', restore);
      window.addEventListener('focus', resumePayment);
      document.addEventListener('visibilitychange', resumePayment);
      return () => {
        suspend();
        window.removeEventListener('popstate', reset);
        window.removeEventListener('pagehide', suspend);
        window.removeEventListener('pageshow', restore);
        window.removeEventListener('focus', resumePayment);
        document.removeEventListener('visibilitychange', resumePayment);
      };
    },
    home() {
      if (state.role !== 'author') navigate(createPath(state.preview));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    navigate,
    replayCelebration() {
      if (state.role === 'payment' && ['notified', 'returned'].includes(state.paymentStatus) && state.receipt) state.celebrationId++;
    },
    scrollTo,
    setSponsorType(type) {
      if (state.busy || (type !== 'person' && type !== 'project')) return;
      state.author.sponsorType = type;
      state.config = null;
      state.error = '';
    },
    setAuthorField(field, value) {
      if (field === 'afdianId' && value.trim().toLowerCase() !== state.author.afdianId.trim().toLowerCase()) notificationAuthorId = null;
      state.author[field] = value;
      state.error = '';
      if (field === 'name' || field === 'repo' || field === 'afdianId' || field === 'stripePaymentLink') state.config = null;
    },
    setPaymentProvider(provider) {
      if (state.busy || (provider !== 'afdian' && provider !== 'stripe')) return;
      state.author.paymentProvider = provider;
      state.config = null;
      state.error = '';
    },
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
      state.config = null;
      state.error = '';
    },
    backToProject() {
      if (state.busy) return;
      client?.disconnect();
      client = null;
      state.connected = false;
      state.step = 1;
      state.error = '';
    },
    backToStores() { if (!state.busy) { state.step = 2; state.error = ''; } },
    backToPayment() { if (!state.busy) { state.step = 3; state.error = ''; } },
    continueToPayment, generateLink,
    setPaymentNotifications(enabled) {
      if (state.role !== 'author' || state.author.paymentProvider === 'stripe') return;
      if (typeof enabled !== 'boolean') throw new TypeError('付款通知开关无效');
      notificationAuthorId = enabled ? validateAfdianId(state.author.afdianId) : null;
      if (state.config) {
        const { notifications: _oldNotifications, ...config } = state.config;
        state.config = normalizeConfig({ ...config, ...(enabled ? { notifications: true } : {}) }) as ShareConfig;
      }
    },
    setCodeTab(value) { state.codeTab = value; },
    setBadgeLanguage(value) {
      const badge = BADGE_LANGUAGES.find(language => language.value === value);
      if (badge) state.badgeLanguage = badge.value;
    },
    shareUrl, badgeMarkup, copy,
    setCategory(index) {
      if (state.menu && Number.isInteger(index) && index >= -1 && index < state.menu.categories.length) state.category = index;
    },
    setSearch(value) { state.search = value; },
    changeQuantity, loadGiftMenu,
    setCustomBlessing(value) { state.customBlessing = value; },
    cycleBlessing() {
      if (state.busy || !state.config) return;
      const blessings = blessingsFor(state.config);
      state.customBlessing = blessings[(blessings.indexOf(state.customBlessing) + 1) % blessings.length];
    },
    pay, payDirect, checkPayment, continuePayment, forgetPayment, paymentUrl,
  };
}

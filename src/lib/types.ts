import type { BadgeLanguage } from './badges.js';

export type SponsorType = 'person' | 'project';
export type PaymentProvider = 'afdian' | 'stripe';
export type ShareConfig = ({ sponsorType: 'person'; name: string; repo?: never }
  | { sponsorType?: 'project'; repo: string; name?: never }) & {
  v: 1; storeCode: string; beType: 1 | 5; orderType: 1;
  afdianId?: string; stripePaymentLink?: string; notifications?: true; stripeReturn?: true;
};
export interface Store {
  storeCode: string; beCode?: string; storeName: string; address?: string;
  distance?: string; businessStatus?: boolean | string;
}
export interface Product {
  code: string; name: string; priceCents: number; originalPriceCents?: number;
  image: string | null; discountType?: string | null;
}
export interface Menu { categories: { name: string; codes: string[] }[]; products: Product[] }
export interface CartItem { code: string; name: string; quantity: number }
export interface ReceiptItem extends CartItem { amountCents?: number }
export interface Quote {
  amountCents: number; originalCents: number; discountCents: number;
  items: (CartItem & { amountCents: number; originalCents: number })[];
}
export interface Author { sponsorType: SponsorType; name: string; repo: string; afdianId: string; paymentProvider: PaymentProvider; stripePaymentLink: string; city: string; keyword: string; beType: 1 | 5 }
export type PaymentReceipt = {
  intentId: string; createdAt: number;
  config: ShareConfig; items: ReceiptItem[]; amountCents: number; blessing: string;
} & ({ provider?: 'afdian'; readToken: string; expiresAt: number; afdianOrderNo?: string }
  | { provider: 'stripe'; readToken?: never; expiresAt?: never; afdianOrderNo?: never });
export type PaymentStatus = 'pending' | 'notified' | 'returned' | 'unknown' | 'error' | 'missing';
export interface AppState {
  preview: boolean; role: 'author' | 'gift' | 'payment'; step: number; connected: boolean;
  busy: string; error: string; config: ShareConfig | null; badLink: boolean;
  author: Author; stores: Store[]; searched: boolean; selected: number | null;
  menu: Menu | null; category: number; search: string; cart: CartItem[];
  quote: Quote | null; celebrationId: number; customBlessing: string;
  codeTab: 'markdown' | 'html'; badgeLanguage: BadgeLanguage;
  receipt: PaymentReceipt | null; paymentStatus: PaymentStatus; paymentBusy: boolean;
  paymentProvider: PaymentProvider;
  checkout: boolean; checkoutProvider: PaymentProvider | null;
  paymentError: string; paymentFallback: boolean; recentReceiptId: string | null;
}
export interface AppController {
  readonly state: AppState;
  readonly toastMessage: string;
  init(): () => void;
  home(): void;
  navigate(path: string): void;
  scrollTo(id: string): void;
  setSponsorType(type: SponsorType): void;
  setAuthorField(field: 'name' | 'repo' | 'afdianId' | 'stripePaymentLink' | 'city' | 'keyword', value: string): void;
  setPaymentProvider(provider: PaymentProvider): void;
  connectAuthor(): Promise<void>;
  searchStores(): Promise<void>;
  locate(): Promise<void>;
  setBeType(value: 1 | 5): void;
  selectStore(index: number): void;
  backToProject(): void;
  backToStores(): void;
  backToPayment(): void;
  continueToPayment(): void;
  generateLink(): void;
  setPaymentNotifications(enabled: boolean): void;
  setStripeReturn(enabled: boolean): void;
  setCodeTab(value: 'markdown' | 'html'): void;
  setBadgeLanguage(value: string): void;
  shareUrl(): string;
  badgeMarkup(): { markdown: string; html: string };
  copy(which: 'link' | 'code'): Promise<void>;
  setCategory(index: number): void;
  setSearch(value: string): void;
  changeQuantity(code: string, delta: 1 | -1): void;
  loadGiftMenu(): Promise<void>;
  setCustomBlessing(value: string): void;
  cycleBlessing(): void;
  replayCelebration(): void;
  choosePayment(): void;
  selectPaymentMethod(provider: PaymentProvider): void;
  backToMenu(): void;
  pay(): Promise<void>;
  payDirect(): void;
  checkPayment(): Promise<void>;
  continuePayment(): void;
  forgetPayment(): void;
  paymentUrl(): string;
}

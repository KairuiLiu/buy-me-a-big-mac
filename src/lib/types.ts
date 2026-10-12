export interface ShareConfig {
  v: 1; repo: string; afdianId: string; storeCode: string; beCode: string;
  storeName: string; beType: 1 | 5; orderType: 1; integrationId?: string;
}
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
export interface Quote {
  amountCents: number; originalCents: number; discountCents: number;
  items: (CartItem & { amountCents: number; originalCents: number })[];
}
export interface Author { repo: string; afdianId: string; city: string; keyword: string; beType: 1 | 5 }
export interface PaymentReceipt {
  intentId: string; readToken: string; expiresAt: number; createdAt: number;
  config: ShareConfig; items: CartItem[]; amountCents: number; blessing: string;
}
export type PaymentStatus = 'pending' | 'notified' | 'unknown' | 'error' | 'missing';
export interface AppState {
  preview: boolean; role: 'author' | 'gift' | 'payment'; step: number; connected: boolean;
  busy: string; error: string; config: ShareConfig | null; badLink: boolean;
  author: Author; stores: Store[]; searched: boolean; selected: number | null;
  menu: Menu | null; category: number; search: string; cart: CartItem[];
  quote: Quote | null; quotedAt: number; quoteStatus: 'idle' | 'scheduled' | 'loading' | 'error';
  confirmed: boolean; celebrationId: number; customBlessing: string;
  codeTab: 'markdown' | 'html';
  receipt: PaymentReceipt | null; paymentStatus: PaymentStatus; paymentBusy: boolean;
  paymentError: string; paymentFallback: boolean; recentReceiptId: string | null;
}
export interface AppController {
  readonly state: AppState;
  readonly toastMessage: string;
  init(): () => void;
  home(): void;
  how(): void;
  scrollTo(id: string): void;
  setAuthorField(field: 'repo' | 'afdianId' | 'city' | 'keyword', value: string): void;
  connectAuthor(): Promise<void>;
  searchStores(): Promise<void>;
  locate(): Promise<void>;
  setBeType(value: 1 | 5): void;
  selectStore(index: number): void;
  backToProject(): void;
  backToStores(): void;
  generateLink(): void;
  setNotificationIntegrationId(id?: string): void;
  setCodeTab(value: 'markdown' | 'html'): void;
  shareUrl(): string;
  badgeMarkup(): { markdown: string; html: string };
  copy(which: 'link' | 'code'): Promise<void>;
  setCategory(index: number): void;
  setSearch(value: string): void;
  changeQuantity(code: string, delta: 1 | -1): void;
  loadGiftMenu(): Promise<void>;
  quote(): Promise<void>;
  setCustomBlessing(value: string): void;
  confirmMeal(): void;
  pay(): Promise<void>;
  payDirect(): void;
  checkPayment(): Promise<void>;
  continuePayment(): void;
  forgetPayment(): void;
  paymentUrl(): string;
}

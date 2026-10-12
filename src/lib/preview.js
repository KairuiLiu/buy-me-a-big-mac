// Local UI fixtures only: no network, no token, and no real payment recipient.
// All displayed amounts are illustrative and must be labelled as such in the UI.
export const demoConfig = Object.freeze({
  v: 1,
  repo: 'KairuiLiu/buy-me-a-big-mac',
  storeCode: 'DEMO-001',
  beCode: '',
  beType: 1,
  orderType: 1,
  afdianId: '00000000000000000000000000000000',
});

const products = [
  { code: 'demo-bigmac', name: '巨无霸', priceCents: 2550, image: '/assets/demo-burger.svg', discountType: '经典之选' },
  { code: 'demo-cheese', name: '双层吉士汉堡', priceCents: 2300, image: '/assets/demo-cheeseburger.svg', discountType: null },
  { code: 'demo-chicken', name: '麦辣鸡腿汉堡', priceCents: 2450, image: '/assets/demo-chicken.svg', discountType: null },
  { code: 'demo-fries', name: '薯条（大份）', priceCents: 1450, image: '/assets/demo-fries.svg', discountType: '快乐加一' },
  { code: 'demo-nuggets', name: '麦乐鸡（5块）', priceCents: 1350, image: '/assets/demo-nuggets.svg', discountType: null },
  { code: 'demo-pie', name: '香芋派', priceCents: 750, image: '/assets/demo-pie.svg', discountType: null },
  { code: 'demo-cola', name: '可口可乐（中杯）', priceCents: 1000, image: '/assets/demo-drink.svg', discountType: null },
  { code: 'demo-coffee', name: '鲜煮咖啡', priceCents: 1200, image: '/assets/demo-coffee.svg', discountType: null },
  { code: 'demo-meal', name: '巨无霸三件套', priceCents: 3650, image: '/assets/demo-meal.svg', discountType: '一顿刚刚好' },
  { code: 'demo-share', name: '双人分享餐', priceCents: 6800, image: '/assets/demo-meal.svg', discountType: '一起加餐' },
].map(product => ({ ...product, originalPriceCents: product.priceCents }));

const menu = {
  categories: [
    { name: '汉堡', codes: ['demo-bigmac', 'demo-cheese', 'demo-chicken'] },
    { name: '小食', codes: ['demo-fries', 'demo-nuggets', 'demo-pie'] },
    { name: '饮品', codes: ['demo-cola', 'demo-coffee'] },
    { name: '套餐', codes: ['demo-meal', 'demo-share'] },
  ],
  products,
};

export function createPreviewClient() {
  let closed = false;
  const reply = async data => {
    if (closed) throw new Error('预览已关闭，请重新打开演示页面');
    return structuredClone(data);
  };
  return {
    async connect() { await reply(null); },
    async searchStores({ beType = 1 } = {}) {
      return reply([
        { storeCode: demoConfig.storeCode, storeName: '朝阳公园餐厅 · 演示门店' },
        { storeCode: 'DEMO-002', storeName: '朝阳公园南门餐厅 · 演示门店' },
        { storeCode: 'DEMO-003', storeName: '朝阳公园西门餐厅 · 演示门店' },
        { storeCode: 'DEMO-004', storeName: '蓝色港湾餐厅 · 演示门店' },
      ].map(store => ({ ...store, beCode: '', address: '本地预览，不对应真实餐厅',
        distance: '演示数据', businessStatus: '演示门店', beType: Number(beType), orderType: 1 })));
    },
    async getMenu() { return reply(menu); },
    async calculate(_config, items) {
      if (!Array.isArray(items) || !items.length || items.length > 30) throw new Error('请先选一份餐品');
      const seen = new Set();
      const quoteItems = items.map(item => {
        const product = products.find(candidate => candidate.code === item?.productCode);
        if (!product || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 || seen.has(product.code)) {
          throw new Error('演示餐品或数量无效');
        }
        seen.add(product.code);
        return { code: product.code, name: product.name, quantity: item.quantity,
          amountCents: product.priceCents * item.quantity, originalCents: product.priceCents * item.quantity };
      });
      const amountCents = quoteItems.reduce((total, item) => total + item.amountCents, 0);
      return reply({ amountCents, originalCents: amountCents, discountCents: 0, items: quoteItems });
    },
    disconnect() { closed = true; },
  };
}

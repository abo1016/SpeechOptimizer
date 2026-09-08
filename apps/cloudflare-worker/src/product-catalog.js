// Pricing 目录是服务端事实源；支付写路径未迁移前 paid products 只允许展示。
const PRODUCTS = Object.freeze({
  free_monthly: Object.freeze({ amount: 0, currency: "USD", purchaseType: "free", period: "month" }),
  flex_20: Object.freeze({ amount: 499, currency: "USD", purchaseType: "one_time", minutes: 20, validityDays: 90 }),
  pro_monthly: Object.freeze({ amount: 1199, currency: "USD", purchaseType: "subscription", minutes: 60, period: "month" }),
});

export function productCatalog({ paymentsEnabled = false, accountMonthlyLimit = 3 } = {}) {
  return Object.fromEntries(Object.entries(PRODUCTS).map(([code, product]) => [code, {
    ...product,
    ...(product.purchaseType === "free" ? { analysesPerMonth: accountMonthlyLimit } : {}),
    checkoutEnabled: product.purchaseType === "free" || paymentsEnabled,
  }]));
}

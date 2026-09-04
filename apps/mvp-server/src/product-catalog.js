import { HttpError } from "./errors.js";

// 商品金额与权益由服务端冻结，HTTP 请求只能提交 productCode，不能覆盖价格事实源。
const PRODUCTS = Object.freeze({
  free_monthly: { amount: 0, currency: "USD", minutes: 5 },
  pro_monthly: { amount: 1200, currency: "USD", minutes: 60 },
  pro_yearly: { amount: 9600, currency: "USD", minutes: 60 },
  minutes_30: { amount: 600, currency: "USD", minutes: 30 },
  minutes_100: { amount: 1500, currency: "USD", minutes: 100 },
  deep_report: { amount: 499, currency: "USD", reports: 1 },
});

export function productCatalog() { return PRODUCTS; }

export function unknownProduct(code) {
  if (!PRODUCTS[code]) throw new HttpError("UNKNOWN_PRODUCT", "未知商品", 400);
  return PRODUCTS[code];
}

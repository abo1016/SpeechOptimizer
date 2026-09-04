export const PRODUCT_RULES = Object.freeze({
  free_monthly: { unit: "minute", amount: 5, purchaseType: "free" },
  pro_monthly: {
    unit: "minute", amount: 60, purchaseType: "subscription",
    periodType: "MONTHLY", periodInterval: "1", benefitMonths: 1,
  },
  pro_yearly: {
    unit: "minute", amount: 60, purchaseType: "subscription",
    periodType: "MONTHLY", periodInterval: "12", benefitMonths: 12,
  },
  minutes_30: { unit: "minute", amount: 30, purchaseType: "one_time" },
  minutes_100: { unit: "minute", amount: 100, purchaseType: "one_time" },
  deep_report: { unit: "report", amount: 1, purchaseType: "one_time" },
});

export function productRule(productCode) {
  return PRODUCT_RULES[productCode] ?? null;
}

export function isSubscriptionProduct(productCode) {
  return productRule(productCode)?.purchaseType === "subscription";
}

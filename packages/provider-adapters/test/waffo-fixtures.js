const logger = { info() {}, warn() {}, error() {} };

/** 构造完整的组合根配置，测试只注入 fake SDK，不访问 Waffo 网络。 */
export function baseOptions(client) {
  return {
    client,
    isUnknownStatusError: (error) => error?.unknownStatus === true,
    productIds: { minutes_30: "PROD_MINUTES", pro_monthly: "PROD_PRO" },
    productNames: { minutes_30: "30 Minutes", pro_monthly: "Pro Monthly" },
    productUrls: { minutes_30: "https://merchant.example/minutes", pro_monthly: "https://merchant.example/pro" },
    productDescriptions: { minutes_30: "30 Minutes", pro_monthly: "Pro Monthly" },
    notifyUrl: "https://merchant.example/webhook",
    refundNotifyUrl: "https://merchant.example/refund-webhook",
    subscriptionManagementUrl: "https://merchant.example/manage",
    successRedirectUrl: "https://merchant.example/success",
    failedRedirectUrl: "https://merchant.example/failed",
    cancelRedirectUrl: "https://merchant.example/cancel",
    userTerminal: "WEB",
    subscriptionPayMethodType: "CREDITCARD,DEBITCARD",
    logger,
  };
}

export function orderInput(overrides = {}) {
  return {
    requestId: "order-request-1", merchantOrderId: "merchant-order-1", amount: 600, currency: "USD",
    productCode: "minutes_30", userId: "user-1", userEmail: "user@example.com",
    userCreatedAt: "2026-09-04T00:00:00.000Z", ...overrides,
  };
}

export function subscriptionInput(overrides = {}) {
  return {
    requestId: "subscription-request-1", merchantSubscriptionId: "merchant-subscription-1", amount: 999,
    currency: "USD", productCode: "pro_monthly", periodType: "MONTHLY", periodInterval: "1",
    userId: "user-1", userEmail: "user@example.com", userCreatedAt: "2026-09-04T00:00:00.000Z", ...overrides,
  };
}

export function action(webUrl) { return JSON.stringify({ actionType: "REDIRECT", webUrl }); }

export function success(data) { return response(true, "0", undefined, data); }

export function failure(code, message) { return response(false, code, message, undefined); }

function response(isSuccess, code, message, data) {
  return { isSuccess: () => isSuccess, getCode: () => code, getMessage: () => message, getData: () => data };
}

export function unknownStatus() {
  return Object.assign(new Error("status unknown"), { unknownStatus: true, errorCode: "S0001" });
}

/** 按真实 SDK 的 resource 工厂与 ApiResponse getter 形态记录调用序列。 */
export function createFakeClient(overrides = {}) {
  const calls = [];
  const next = (name, params) => {
    calls.push({ operation: name, params });
    const key = name.replace(/\.(.)/g, (_, letter) => letter.toUpperCase());
    const value = overrides[key] ?? success({});
    const result = typeof value === "function" ? value(params) : value;
    if (result instanceof Error) throw result;
    return result;
  };
  const client = {
    order: () => ({
      create: (params) => next("order.create", params),
      inquiry: (params) => next("order.inquiry", params),
      refund: (params) => next("order.refund", params),
    }),
    subscription: () => ({
      create: (params) => next("subscription.create", params),
      inquiry: (params) => next("subscription.inquiry", params),
      cancel: (params) => next("subscription.cancel", params),
    }),
    refund: () => ({ inquiry: (params) => next("refund.inquiry", params) }),
  };
  return { client, calls };
}

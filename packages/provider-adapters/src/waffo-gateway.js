import { ProviderError } from "./errors.js";

const SUBSCRIPTION_PRODUCTS = new Set(["pro_monthly", "pro_yearly"]);

/**
 * 适配官方 @waffo/pancake-ts 客户端；本包不安装 SDK，由应用组合根注入实例。
 */
export function createWaffoGateway(options = {}) {
  const config = createConfig(options);
  return {
    createOrder: (input) => createOrder(input, config),
    cancelSubscription: (input) => cancelSubscription(input, config),
    refundOrder: () => unavailableRefund(),
  };
}

function createConfig(options) {
  if (typeof options.client?.checkout?.createSession !== "function") {
    throw new ProviderError("WAFFO_NOT_CONFIGURED", "需要注入官方 WaffoPancake client");
  }
  return Object.freeze({
    // productIds：SpeechOptimizer 商品代码到 Waffo PROD_xxx 的显式映射。
    productIds: Object.freeze({ ...(options.productIds ?? {}) }),
    // successUrl：支付成功后回跳地址，必须由服务端配置。
    successUrl: options.successUrl,
    // taxCategory：动态价格快照所需税务类别，MVP 默认 SaaS。
    taxCategory: options.taxCategory ?? "saas",
    client: options.client,
    logger: options.logger ?? console,
  });
}

async function createOrder(input, config) {
  if (input.currency !== "USD") throw new ProviderError("WAFFO_UNSUPPORTED_CURRENCY", "MVP Waffo 适配器仅支持 USD");
  const productId = config.productIds[input.productCode];
  if (!productId) throw new ProviderError("WAFFO_PRODUCT_NOT_CONFIGURED", `未配置商品 ${input.productCode}`);
  const session = await callWaffo(() => config.client.checkout.createSession({
    productId,
    productType: SUBSCRIPTION_PRODUCTS.has(input.productCode) ? "subscription" : "onetime",
    currency: input.currency,
    priceSnapshot: { amount: minorUsdToDisplay(input.amount), taxIncluded: true, taxCategory: config.taxCategory },
    successUrl: config.successUrl,
    orderMerchantExternalId: input.requestId,
    metadata: { localOrderId: input.requestId, productCode: input.productCode },
  }));
  if (!session?.sessionId || !session?.checkoutUrl) throw new ProviderError("WAFFO_INVALID_RESPONSE", "Waffo checkout 响应缺少 sessionId 或 checkoutUrl");
  config.logger.info?.("[waffo] checkout session 已创建", { requestId: input.requestId, productCode: input.productCode });
  return { externalOrderId: session.sessionId, checkoutUrl: session.checkoutUrl };
}

async function cancelSubscription(input, config) {
  if (typeof config.client.orders?.cancelSubscription !== "function") {
    throw new ProviderError("WAFFO_CANCEL_UNAVAILABLE", "注入的 Waffo 客户端不支持取消订阅");
  }
  const result = await callWaffo(() => config.client.orders.cancelSubscription({ orderId: input.externalSubscriptionId }));
  config.logger.info?.("[waffo] 订阅取消已请求", { requestId: input.requestId });
  return result;
}

async function unavailableRefund() {
  throw new ProviderError(
    "WAFFO_REFUND_CONTRACT_UNAVAILABLE",
    "退款暂不可用：官方接口需要 paymentId、退款金额和币种，当前业务端口未提供这些字段",
  );
}

function minorUsdToDisplay(amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new ProviderError("WAFFO_INVALID_AMOUNT", "USD 金额必须是正整数美分");
  return (amount / 100).toFixed(2);
}

async function callWaffo(operation) {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    const status = cause?.status;
    const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
    throw new ProviderError("WAFFO_REQUEST_FAILED", "Waffo SDK 请求失败", { status, retryable, cause });
  }
}

/** 创建所有方法均稳定失败的 gateway，供缺少官方 SDK 或凭证时显式降级。 */
export function createUnavailableWaffoGateway(reason = "Waffo 未配置") {
  const fail = async () => { throw new ProviderError("WAFFO_UNAVAILABLE", reason); };
  return { createOrder: fail, cancelSubscription: fail, refundOrder: fail };
}

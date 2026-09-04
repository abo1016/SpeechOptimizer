import { ProviderError } from "./errors.js";

const USD_MINOR_UNIT_SCALE = 100;
const DEFAULT_UNKNOWN_STATUS_CODES = new Set(["S0001", "E0001"]);

/** 构造 gateway 配置快照；所有 SDK 与业务元数据均从组合根注入。 */
export function createConfig(options) {
  if (!options.client || (typeof options.client !== "object" && typeof options.client !== "function")) {
    throw new ProviderError("WAFFO_NOT_CONFIGURED", "需要注入官方 @waffo/waffo-node client");
  }
  const isUnknownStatusError = options.isUnknownStatusError ?? isDefaultUnknownStatusError;
  if (typeof isUnknownStatusError !== "function") {
    throw new ProviderError("WAFFO_NOT_CONFIGURED", "需要注入 Waffo UnknownStatus predicate");
  }
  return Object.freeze({
    client: options.client,
    isUnknownStatusError,
    // 商品 ID 必须由服务端配置，不能从客户端 productCode 拼接。
    productIds: copyMap(options.productIds),
    productNames: copyMap(options.productNames),
    productUrls: copyMap(options.productUrls),
    productDescriptions: copyMap(options.productDescriptions),
    productMetadata: copyMap(options.productMetadata ?? options.products),
    // 逐商品没有配置时使用的展示元数据；不伪造 appName 或商品页。
    goodsName: options.goodsName,
    goodsUrl: options.goodsUrl,
    // 通知、回跳和订阅管理 URL 均由服务端配置，不能从请求参数带入。
    notifyUrl: options.notifyUrl,
    refundNotifyUrl: options.refundNotifyUrl,
    subscriptionManagementUrl: options.subscriptionManagementUrl,
    successRedirectUrl: options.successRedirectUrl ?? options.successUrl,
    failedRedirectUrl: options.failedRedirectUrl,
    cancelRedirectUrl: options.cancelRedirectUrl,
    // 这些值属于商户决策；adapter 只在显式注入时发送。
    userTerminal: options.userTerminal,
    orderPayMethodType: options.orderPayMethodType,
    orderPayMethodName: options.orderPayMethodName,
    subscriptionPayMethodType: options.subscriptionPayMethodType,
    subscriptionPayMethodName: options.subscriptionPayMethodName,
    logger: options.logger ?? console,
  });
}

export function buildUserInfo(input, config) {
  const userInfo = {
    userId: requiredText(input.userId, "WAFFO_INVALID_INPUT", "userId 不能为空"),
    userEmail: requiredText(input.userEmail, "WAFFO_INVALID_INPUT", "userEmail 不能为空"),
  };
  addDefined(userInfo, "userCreatedAt", normalizeUserCreatedAt(input.userCreatedAt));
  addDefined(userInfo, "userTerminal", input.userTerminal ?? config.userTerminal);
  return userInfo;
}

export function buildPaymentInfo(productName, payMethodType, payMethodName) {
  const paymentInfo = { productName };
  addDefined(paymentInfo, "payMethodType", payMethodType);
  addDefined(paymentInfo, "payMethodName", payMethodName);
  return paymentInfo;
}

export function resolveProduct(productCode, config) {
  const code = requiredText(productCode, "WAFFO_INVALID_INPUT", "productCode 不能为空");
  const metadata = isRecord(config.productMetadata[code]) ? config.productMetadata[code] : {};
  const goodsId = metadata.goodsId ?? metadata.productId ?? config.productIds[code];
  if (typeof goodsId !== "string" || goodsId.trim() === "") {
    throw new ProviderError("WAFFO_PRODUCT_NOT_CONFIGURED", `未配置商品 ${code}`);
  }
  const goodsName = metadata.goodsName ?? metadata.name ?? config.productNames[code] ?? config.goodsName ?? code;
  const goodsUrl = metadata.goodsUrl ?? metadata.url ?? config.productUrls[code] ?? config.goodsUrl;
  const goodsInfo = { goodsId, goodsName: requiredText(goodsName, "WAFFO_PRODUCT_NOT_CONFIGURED", "商品名不能为空") };
  addDefined(goodsInfo, "goodsUrl", goodsUrl);
  return {
    description: metadata.description ?? config.productDescriptions[code] ?? goodsInfo.goodsName,
    goodsInfo,
  };
}

export function buildOrderInquiryParams(input) {
  if (input.requestId) return { paymentRequestId: input.requestId };
  if (input.acquiringOrderId) return { acquiringOrderId: input.acquiringOrderId };
  throw new ProviderError("WAFFO_INVALID_INPUT", "订单 inquiry 需要 requestId 或 acquiringOrderId");
}

export function buildSubscriptionInquiryParams(input) {
  if (input.requestId || input.subscriptionRequest) {
    return { subscriptionRequest: input.requestId ?? input.subscriptionRequest };
  }
  if (input.externalSubscriptionId || input.subscriptionId) {
    return { subscriptionId: input.externalSubscriptionId ?? input.subscriptionId };
  }
  throw new ProviderError("WAFFO_INVALID_INPUT", "订阅 inquiry 需要 requestId 或 externalSubscriptionId");
}

export function buildRefundInquiryParams(input) {
  if (input.refundRequestId) return { refundRequestId: input.refundRequestId };
  if (input.acquiringRefundOrderId) return { acquiringRefundOrderId: input.acquiringRefundOrderId };
  throw new ProviderError("WAFFO_INVALID_INPUT", "退款 inquiry 需要 refundRequestId 或 acquiringRefundOrderId");
}

export function normalizePeriodInterval(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  throw new ProviderError("WAFFO_INVALID_INPUT", "订阅 periodInterval 必须是正整数");
}

/** USD 金额唯一转换 helper：把正整数美分精确转换为 Waffo 所需的两位小数字符串。 */
export function minorUsdToDecimal(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ProviderError("WAFFO_INVALID_AMOUNT", "USD 金额必须是正整数最小货币单位");
  }
  const minor = BigInt(amount);
  const major = minor / BigInt(USD_MINOR_UNIT_SCALE);
  const cents = String(minor % BigInt(USD_MINOR_UNIT_SCALE)).padStart(2, "0");
  return `${major}.${cents}`;
}

export function assertCurrency(currency) {
  if (currency !== "USD") throw new ProviderError("WAFFO_UNSUPPORTED_CURRENCY", "Waffo 适配器仅支持 USD");
}

/** 将 AuthService 的 epoch milliseconds 或日期字符串统一成 SDK 所需的 ISO-8601 字符串。 */
export function normalizeUserCreatedAt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new ProviderError("WAFFO_INVALID_INPUT", "userCreatedAt 时间戳无效");
    return dateToIso(new Date(value));
  }
  if (typeof value === "string") return dateToIso(new Date(value));
  throw new ProviderError("WAFFO_INVALID_INPUT", "userCreatedAt 必须是时间戳或日期字符串");
}

export function requiredText(value, code, message) {
  if (typeof value !== "string" || value.trim() === "") throw new ProviderError(code, message);
  return value;
}

function isDefaultUnknownStatusError(error) {
  const code = error?.errorCode ?? error?.code;
  return DEFAULT_UNKNOWN_STATUS_CODES.has(code) || error?.name === "WaffoUnknownStatusError";
}

function dateToIso(date) {
  if (Number.isNaN(date.getTime())) throw new ProviderError("WAFFO_INVALID_INPUT", "userCreatedAt 日期无效");
  return date.toISOString();
}

function addDefined(target, key, value) {
  if (value !== undefined && value !== null) target[key] = value;
}

function copyMap(value) {
  return Object.freeze(isRecord(value) ? { ...value } : {});
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

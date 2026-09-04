import { ProviderError } from "./errors.js";
import { requiredText } from "./waffo-gateway-support.js";

const TRANSIENT_STATUS_CODES = new Set([408, 409, 429]);
const ORDER_INQUIRY_SUCCESS_STATUSES = new Set([
  "PAY_IN_PROGRESS", "AUTHORIZATION_REQUIRED", "AUTHED_WAITING_CAPTURE", "PAY_SUCCESS",
]);
const SUBSCRIPTION_CREATE_SUCCESS_STATUSES = new Set(["AUTHORIZATION_REQUIRED", "IN_PROGRESS", "ACTIVE"]);
const REFUND_CONFIRMED_STATUSES = new Set(["REFUND_IN_PROGRESS", "ORDER_PARTIALLY_REFUNDED", "ORDER_FULLY_REFUNDED"]);
const REFUND_FAILURE_STATUS = "ORDER_REFUND_FAILED";
const CANCEL_CONFIRMED_STATUSES = new Set([
  "CLOSE", "CANCELED", "CANCELLED", "MERCHANT_CANCELLED", "USER_CANCELLED", "CHANNEL_CANCELLED", "EXPIRED",
]);

/** 读取类调用统一解包 SDK ApiResponse，并把异常归一为稳定 ProviderError。 */
export async function readOperation(config, operation, resourceName, methodName, params) {
  try {
    const response = await callSdk(config, resourceName, methodName, params);
    return unwrapApiResponse(response, operation);
  } catch (cause) {
    throw toProviderError(cause, operation);
  }
}

/**
 * 资金 write 遇到 UnknownStatus 时只能使用同一个 request ID inquiry。
 * inquiry 不能证明原 mutation 成功时保持 fail closed，禁止重新发起 write。
 */
export async function writeWithSameKeyInquiry({ config, operation, requestId, write, inquiry, recover }) {
  try {
    return unwrapApiResponse(await write(), operation);
  } catch (cause) {
    if (!isUnknownStatus(config, cause)) throw toProviderError(cause, operation);
    config.logger.warn?.("[waffo] write 状态未知，使用同一 request ID inquiry", { operation, requestId });
    try {
      const data = unwrapApiResponse(await inquiry(), `${operation}.inquiry`);
      return recover ? recover(data) : data;
    } catch (inquiryError) {
      if (inquiryError instanceof ProviderError && inquiryError.code === "WAFFO_OPERATION_FAILED") throw inquiryError;
      config.logger.warn?.("[waffo] 同键 inquiry 仍无法确认状态", { operation, requestId });
      throw new ProviderError("WAFFO_STATUS_UNCONFIRMED", "Waffo 操作状态无法确认", {
        retryable: true,
        details: { operation, requestId, inquiryCode: inquiryError?.details?.providerCode },
      });
    }
  }
}

/** 只通过已注入的官方 SDK resource 调用，不在 adapter 内创建额外 client 或凭证。 */
export async function callSdk(config, resourceName, methodName, params) {
  const resourceFactory = config.client?.[resourceName];
  if (typeof resourceFactory !== "function") {
    throw new ProviderError("WAFFO_NOT_CONFIGURED", `Waffo client 缺少 ${resourceName}() resource`);
  }
  const resource = resourceFactory.call(config.client);
  if (typeof resource?.[methodName] !== "function") {
    throw new ProviderError("WAFFO_NOT_CONFIGURED", `Waffo ${resourceName}() 缺少 ${methodName}() 方法`);
  }
  return resource[methodName].call(resource, params);
}

export function normalizeCreatedOrder(data) {
  return Object.freeze({
    acquiringOrderId: requiredText(data.acquiringOrderId, "WAFFO_INVALID_RESPONSE", "成功订单响应缺少 acquiringOrderId"),
    checkoutUrl: parseHostedCheckoutUrl(data.orderAction, "orderAction"),
  });
}

/** UnknownStatus 后只有明确成功状态和完整订单结果才能证明原 create 已成立。 */
export function recoverCreatedOrder(data, operation = "order.create") {
  assertInquiryStatus(data.orderStatus, operation);
  try { normalizeCreatedOrder(data); } catch (cause) { throw uncertainOperation(operation, cause.message); }
  return data;
}

export function normalizeOrderInquiry(data, input) {
  const result = {};
  addDefined(result, "acquiringOrderId", data.acquiringOrderId ?? input.acquiringOrderId);
  addDefined(result, "status", data.orderStatus);
  addOptionalAction(result, data.orderAction, "orderAction");
  return Object.freeze(result);
}

export function normalizeRefund(data) {
  const result = {};
  addDefined(result, "acquiringRefundOrderId", data.acquiringRefundOrderId);
  return Object.freeze(result);
}

/** 退款 inquiry 必须有明确业务状态，不能把任意成功 HTTP 响应当成退款成功。 */
export function recoverRefund(data, operation = "order.refund") {
  if (data.refundStatus === REFUND_FAILURE_STATUS) throw failedOperation(operation, data.refundStatus);
  if (!REFUND_CONFIRMED_STATUSES.has(data.refundStatus)) {
    throw uncertainOperation(operation, data.refundStatus ?? "missing refundStatus");
  }
  return data;
}

export function normalizeRefundInquiry(data, input) {
  const result = {};
  addDefined(result, "acquiringRefundOrderId", data.acquiringRefundOrderId ?? input.acquiringRefundOrderId);
  addDefined(result, "status", data.refundStatus);
  return Object.freeze(result);
}

export function normalizeCreatedSubscription(data) {
  return Object.freeze({
    externalSubscriptionId: requiredText(data.subscriptionId, "WAFFO_INVALID_RESPONSE", "成功订阅响应缺少 subscriptionId"),
    checkoutUrl: parseHostedCheckoutUrl(data.subscriptionAction, "subscriptionAction"),
  });
}

/** UnknownStatus 后只有明确成功状态和完整订阅结果才能证明原 create 已成立。 */
export function recoverCreatedSubscription(data, operation = "subscription.create") {
  assertInquiryStatus(data.subscriptionStatus, operation);
  try { normalizeCreatedSubscription(data); } catch (cause) { throw uncertainOperation(operation, cause.message); }
  return data;
}

/** 取消订阅只有终态取消状态才是已确认成功，ACTIVE/pending 必须保留不确定态。 */
export function recoverCancelledSubscription(data, operation = "subscription.cancel") {
  const status = data.subscriptionStatus ?? data.orderStatus;
  if (!CANCEL_CONFIRMED_STATUSES.has(status)) throw uncertainOperation(operation, status ?? "missing subscriptionStatus");
  return data;
}

export function normalizeSubscriptionInquiry(data, input) {
  const result = {};
  addDefined(result, "externalSubscriptionId", data.subscriptionId ?? input.externalSubscriptionId ?? input.subscriptionId);
  addDefined(result, "status", data.subscriptionStatus);
  addOptionalAction(result, data.subscriptionAction, "subscriptionAction");
  return Object.freeze(result);
}

export function normalizeCancelledSubscription(data, fallbackId) {
  const result = { externalSubscriptionId: data.subscriptionId ?? fallbackId };
  addDefined(result, "status", data.subscriptionStatus ?? data.orderStatus);
  return Object.freeze(result);
}

function unwrapApiResponse(response, operation) {
  if (!isRecord(response)) throw invalidResponse(operation, "SDK 未返回 ApiResponse");
  let success;
  let code;
  let message;
  let data;
  try {
    success = typeof response.isSuccess === "function" ? response.isSuccess() : response.code === "0";
    code = typeof response.getCode === "function" ? response.getCode() : response.code;
    message = typeof response.getMessage === "function" ? response.getMessage() : response.message;
    data = typeof response.getData === "function" ? response.getData() : response.data;
  } catch (cause) {
    throw invalidResponse(operation, "SDK ApiResponse getter 异常", cause);
  }
  if (!success) {
    throw new ProviderError("WAFFO_API_ERROR", `Waffo ${operation} 返回失败`, {
      details: { providerCode: code ?? "UNKNOWN", providerMessage: message ?? "" },
    });
  }
  if (!isRecord(data)) throw invalidResponse(operation, "成功响应缺少 data");
  return data;
}

function addOptionalAction(result, action, fieldName) {
  if (action !== undefined && action !== null) result.checkoutUrl = parseHostedCheckoutUrl(action, fieldName);
}

function parseHostedCheckoutUrl(action, fieldName) {
  let parsed = action;
  if (typeof action === "string") {
    try { parsed = JSON.parse(action); } catch (cause) { throw invalidResponse(fieldName, "action 不是有效 JSON", cause); }
  }
  const webUrl = parsed?.webUrl;
  if (typeof webUrl !== "string" || webUrl.trim() === "") throw invalidResponse(fieldName, "action 缺少 webUrl");
  try { new URL(webUrl); } catch (cause) { throw invalidResponse(fieldName, "webUrl 不是有效 URL", cause); }
  return webUrl.trim();
}

function isUnknownStatus(config, error) {
  try { return config.isUnknownStatusError(error) === true; } catch { return false; }
}

function toProviderError(cause, operation) {
  if (cause instanceof ProviderError) return cause;
  const status = cause?.status ?? cause?.statusCode;
  const retryable = cause?.retryable === true || isTransientStatus(status);
  return new ProviderError("WAFFO_REQUEST_FAILED", `Waffo ${operation} 请求失败`, { status, retryable, cause });
}

function isTransientStatus(status) {
  return TRANSIENT_STATUS_CODES.has(status) || (Number.isInteger(status) && status >= 500);
}

function invalidResponse(operation, message, cause) {
  return new ProviderError("WAFFO_INVALID_RESPONSE", `Waffo ${operation} 响应无效：${message}`, { cause });
}

function assertInquiryStatus(status, operation) {
  if (status === undefined || status === null || status === "") throw uncertainOperation(operation, "missing status");
  if (operation === "order.create") return assertOrderCreateStatus(status, operation);
  if (operation === "subscription.create") return assertSubscriptionCreateStatus(status, operation);
  throw uncertainOperation(operation, status);
}

function assertOrderCreateStatus(status, operation) {
  if (status === "ORDER_CLOSE") throw failedOperation(operation, status);
  if (!ORDER_INQUIRY_SUCCESS_STATUSES.has(status)) throw uncertainOperation(operation, status);
}

function assertSubscriptionCreateStatus(status, operation) {
  if (status === "CLOSE") throw failedOperation(operation, status);
  if (!SUBSCRIPTION_CREATE_SUCCESS_STATUSES.has(status)) throw uncertainOperation(operation, status);
}

function failedOperation(operation, status) {
  return new ProviderError("WAFFO_OPERATION_FAILED", `Waffo ${operation} 已明确失败`, {
    details: { providerStatus: status },
  });
}

function uncertainOperation(operation, status) {
  return new ProviderError("WAFFO_STATUS_UNCONFIRMED", `Waffo ${operation} 状态无法确认`, {
    retryable: true,
    details: { providerStatus: status },
  });
}

function addDefined(target, key, value) {
  if (value !== undefined && value !== null) target[key] = value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

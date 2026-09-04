import { createHash } from "node:crypto";

const PAYMENT_SUCCESS = "PAY_SUCCESS";
const PAYMENT_FAILED = "ORDER_CLOSE";
const REFUND_IN_PROGRESS = "REFUND_IN_PROGRESS";
const REFUND_FAILED = "ORDER_REFUND_FAILED";
const REFUND_PARTIAL = "ORDER_PARTIALLY_REFUNDED";
const REFUND_FULL = "ORDER_FULLY_REFUNDED";
const SUBSCRIPTION_ACTIVE = "ACTIVE";
const SUBSCRIPTION_PENDING = new Set(["AUTHORIZATION_REQUIRED", "IN_PROGRESS"]);
const SUBSCRIPTION_TERMINAL = new Set(["CLOSE", "MERCHANT_CANCELLED", "USER_CANCELLED", "CHANNEL_CANCELLED", "EXPIRED"]);
const PAYMENT_PENDING = new Set(["PAY_IN_PROGRESS", "AUTHORIZATION_REQUIRED", "AUTHED_WAITING_CAPTURE"]);
const SUBSCRIPTION_PRODUCT_NAMES = new Set(["SUBSCRIPTION", "MINI_PROGRAM_SUBSCRIPTION"]);

/**
 * 以官方 SDK 3.0.1 的回调接口绑定领域 Webhook；这里不注册 SDK 的 subscription change 回调。
 * SDK 会负责 X-SIGNATURE 验证和 responseBody/responseSignature 生成，本层只负责归一化与落库。
 */
export function createWaffoWebhookHandler(client, application) {
  const handler = client.webhook();
  const methods = ["onPayment", "onRefund", "onSubscriptionStatus", "onSubscriptionPeriodChanged"];
  if (!handler || methods.some((method) => typeof handler[method] !== "function")) {
    throw new Error("Waffo client webhook() 契约无效");
  }
  const process = (notification) => application.billing.processWebhook(normalizeWaffoNotification(notification));
  return handler
    .onPayment(process)
    .onRefund(process)
    .onSubscriptionStatus(process)
    .onSubscriptionPeriodChanged(process);
}

/** 将官方通知投影为账户计费领域固定事件，禁止把 userInfo/payment token 等原始敏感字段写入快照。 */
export function normalizeWaffoNotification(notification, now = Date.now()) {
  const result = isRecord(notification?.result) ? notification.result : {};
  const data = normalizeData(result);
  return {
    id: eventId(notification, result),
    version: normalizeVersion(notification?.version ?? notification?.eventVersion),
    type: resolveType(notification?.eventType, data),
    occurredAt: resolveOccurredAt(notification, result, now),
    data,
  };
}

function normalizeData(result) {
  const subscriptionInfo = isRecord(result.subscriptionInfo) ? result.subscriptionInfo : {};
  const productInfo = isRecord(result.productInfo) ? result.productInfo : {};
  const paymentInfo = isRecord(result.paymentInfo) ? result.paymentInfo : {};
  const lastPayment = Array.isArray(result.paymentDetails) ? result.paymentDetails.at(-1) ?? {} : {};
  const data = {};
  add(data, "orderId", firstText(result.merchantOrderId, result.orderId));
  add(data, "paymentRequestId", firstText(result.paymentRequestId, result.origPaymentRequestId));
  add(data, "acquiringOrderId", firstText(result.acquiringOrderId, lastPayment.acquiringOrderId));
  add(data, "amount", decimalToMinor(result.orderAmount ?? lastPayment.orderAmount ?? result.amount));
  add(data, "currency", firstText(result.orderCurrency, lastPayment.orderCurrency, result.currency));
  add(data, "orderStatus", firstText(result.orderStatus, lastPayment.orderStatus));
  add(data, "failureCode", reasonCode(result.orderFailedReason ?? result.failedReason));
  add(data, "refundRequestId", firstText(result.refundRequestId));
  add(data, "acquiringRefundOrderId", firstText(result.acquiringRefundOrderId));
  add(data, "origPaymentRequestId", firstText(result.origPaymentRequestId));
  add(data, "refundAmount", decimalToMinor(result.refundAmount));
  add(data, "refundStatus", firstText(result.refundStatus));
  if (result.refundStatus) add(data, "partial", result.refundStatus === REFUND_PARTIAL);

  const subscriptionRequest = firstText(result.subscriptionRequest,
    subscriptionInfo.subscriptionRequest, subscriptionInfo.merchantRequest);
  const subscriptionId = firstText(result.subscriptionId, subscriptionInfo.subscriptionId);
  add(data, "subscriptionRequest", subscriptionRequest);
  add(data, "subscriptionId", subscriptionId);
  add(data, "externalSubscriptionId", subscriptionId);
  add(data, "subscriptionStatus", firstText(result.subscriptionStatus));
  add(data, "periodId", firstText(result.period, subscriptionInfo.period,
    productInfo.currentPeriod, lastPayment.period));
  add(data, "periodStart", timestampValue(productInfo.startDateTime ?? result.periodStart));
  add(data, "currentPeriodEnd", timestampValue(productInfo.nextPaymentDateTime
    ?? result.currentPeriodEnd ?? result.nextPaymentAt ?? result.nextChargeAt));
  const safeInfo = safePaymentInfo(paymentInfo);
  if (safeInfo) data.paymentInfo = safeInfo;
  return data;
}

function resolveType(eventType, data) {
  if (eventType === "PAYMENT_NOTIFICATION") return resolvePaymentType(data);
  if (eventType === "REFUND_NOTIFICATION") return resolveRefundType(data.refundStatus);
  if (eventType === "SUBSCRIPTION_STATUS_NOTIFICATION") return resolveSubscriptionStatusType(data.subscriptionStatus);
  if (eventType === "SUBSCRIPTION_PERIOD_CHANGED_NOTIFICATION") return resolvePeriodType(data);
  throw unsupportedNotification("eventType", eventType);
}

function resolvePaymentType(data) {
  const productName = String(data.paymentInfo?.productName ?? "").toUpperCase();
  const isSubscription = SUBSCRIPTION_PRODUCT_NAMES.has(productName)
    || Boolean(data.subscriptionId || data.subscriptionRequest);
  const status = data.orderStatus;
  assertSupported(status, new Set([...PAYMENT_PENDING, PAYMENT_SUCCESS, PAYMENT_FAILED]), "orderStatus");
  if (isSubscription) {
    // 订阅付款只记录付款事实；失败使用 payment.failed 让领域层进入 past_due，同样绝不发一次性权益。
    if (status === PAYMENT_FAILED) return "payment.failed";
    if (PAYMENT_PENDING.has(status)) return "payment.pending";
    return "subscription.payment";
  }
  if (status === PAYMENT_SUCCESS) return "order.paid";
  if (status === PAYMENT_FAILED) return "payment.failed";
  throw unsupportedNotification("orderStatus", status);
}

function resolveRefundType(status) {
  if (status === REFUND_IN_PROGRESS) return "refund.pending";
  if (status === REFUND_FAILED) return "refund.failed";
  if (status === REFUND_PARTIAL || status === REFUND_FULL) return "order.refunded";
  throw unsupportedNotification("refundStatus", status);
}

function resolveSubscriptionStatusType(status) {
  if (status === SUBSCRIPTION_ACTIVE) return "subscription.activated";
  if (SUBSCRIPTION_PENDING.has(status)) return "subscription.pending";
  if (SUBSCRIPTION_TERMINAL.has(status)) return "subscription.canceled";
  throw unsupportedNotification("subscriptionStatus", status);
}

function resolvePeriodType(data) {
  const status = data.orderStatus;
  const subscriptionStatus = data.subscriptionStatus;
  const knownPaymentStatuses = new Set([...PAYMENT_PENDING, PAYMENT_SUCCESS, PAYMENT_FAILED]);
  const knownSubscriptionStatuses = new Set([SUBSCRIPTION_ACTIVE, ...SUBSCRIPTION_PENDING, ...SUBSCRIPTION_TERMINAL]);
  if (status !== undefined) assertSupported(status, knownPaymentStatuses, "orderStatus");
  if (subscriptionStatus !== undefined) {
    assertSupported(subscriptionStatus, knownSubscriptionStatuses, "subscriptionStatus");
  }
  if (status === PAYMENT_FAILED) return "payment.failed";
  if (status === PAYMENT_SUCCESS || subscriptionStatus === SUBSCRIPTION_ACTIVE) return "subscription.renewed";
  if (PAYMENT_PENDING.has(status)) return "payment.pending";
  if (SUBSCRIPTION_TERMINAL.has(subscriptionStatus)) return "subscription.canceled";
  if (SUBSCRIPTION_PENDING.has(subscriptionStatus)) return "subscription.pending";
  throw unsupportedNotification("period status", { orderStatus: status, subscriptionStatus });
}

function resolveOccurredAt(notification, result, now) {
  const details = Array.isArray(result.paymentDetails) ? result.paymentDetails.at(-1) ?? {} : {};
  const candidates = [notification?.occurredAt, notification?.eventTime, result.occurredAt,
    result.orderCompletedAt, result.orderUpdatedAt, result.refundCompletedAt,
    result.refundUpdatedAt, result.updatedAt, result.requestedAt,
    result.productInfo?.startDateTime, details.orderUpdatedAt];
  for (const candidate of candidates) {
    const timestamp = timestampValue(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.isFinite(now) ? now : Date.now();
}

function eventId(notification, result) {
  const explicit = firstText(notification?.id, notification?.eventId, result.id, result.eventId);
  if (explicit) return explicit;
  const body = JSON.stringify(notification) ?? "";
  return `waffo_${createHash("sha256").update(body).digest("hex")}`;
}

function normalizeVersion(value) {
  const version = Number(value ?? 1);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

function safePaymentInfo(paymentInfo) {
  const result = {};
  add(result, "productName", firstText(paymentInfo.productName));
  add(result, "payMethodType", firstText(paymentInfo.payMethodType));
  add(result, "payMethodName", firstText(paymentInfo.payMethodName));
  return Object.keys(result).length > 0 ? result : null;
}

function reasonCode(reason) {
  if (typeof reason === "string") return reason;
  if (!isRecord(reason)) return undefined;
  return firstText(reason.code, reason.reasonCode, reason.errorCode);
}

function decimalToMinor(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    value = String(value);
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return undefined;
  const [major, fraction = ""] = value.trim().split(".");
  const minor = BigInt(major) * 100n + BigInt(fraction.padEnd(2, "0"));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : undefined;
}

function timestampValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return normalizeNumericTimestamp(value);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) return normalizeNumericTimestamp(Number(value));
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeNumericTimestamp(value) {
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim() !== "");
}

function add(target, key, value) {
  if (value !== undefined && value !== null) target[key] = value;
}

function assertSupported(value, supported, fieldName) {
  if (typeof value !== "string" || !supported.has(value)) throw unsupportedNotification(fieldName, value);
}

function unsupportedNotification(fieldName, value) {
  const error = new Error(`Waffo Webhook ${fieldName} 不受支持`);
  error.code = "WAFFO_UNSUPPORTED_NOTIFICATION";
  error.details = { fieldName, status: typeof value === "string" ? value : "missing" };
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

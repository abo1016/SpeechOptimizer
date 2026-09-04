import { ProviderError } from "./errors.js";
import {
  assertCurrency,
  buildOrderInquiryParams,
  buildRefundInquiryParams,
  buildSubscriptionInquiryParams,
  buildPaymentInfo,
  buildUserInfo,
  createConfig,
  minorUsdToDecimal,
  normalizePeriodInterval,
  resolveProduct,
  requiredText,
} from "./waffo-gateway-support.js";
import {
  callSdk,
  normalizeCancelledSubscription,
  normalizeCreatedOrder,
  normalizeCreatedSubscription,
  normalizeOrderInquiry,
  normalizeRefund,
  normalizeRefundInquiry,
  normalizeSubscriptionInquiry,
  recoverCancelledSubscription,
  recoverCreatedOrder,
  recoverCreatedSubscription,
  recoverRefund,
  readOperation,
  writeWithSameKeyInquiry,
} from "./waffo-gateway-response.js";

const ONE_TIME_PRODUCT_NAME = "ONE_TIME_PAYMENT";
const SUBSCRIPTION_PRODUCT_NAME = "SUBSCRIPTION";

/**
 * 创建 provider-agnostic Waffo gateway。
 * SDK client 与 UnknownStatus 判断器均由组合根注入，避免本包绑定 SDK 依赖或私钥。
 */
export function createWaffoGateway(options = {}) {
  const config = createConfig(options);
  return Object.freeze({
    createOrder: (input) => createOrder(input, config),
    inquiryOrder: (input) => inquiryOrder(input, config),
    refundOrder: (input) => refundOrder(input, config),
    createSubscription: (input) => createSubscription(input, config),
    inquirySubscription: (input) => inquirySubscription(input, config),
    cancelSubscription: (input) => cancelSubscription(input, config),
    inquiryRefund: (input) => inquiryRefund(input, config),
  });
}

async function createOrder(input = {}, config) {
  assertCurrency(input.currency);
  const amount = minorUsdToDecimal(input.amount);
  const requestId = requiredText(input.requestId, "WAFFO_INVALID_INPUT", "订单 requestId 不能为空");
  const merchantOrderId = requiredText(input.merchantOrderId, "WAFFO_INVALID_INPUT", "merchantOrderId 不能为空");
  const params = buildOrderParams({ ...input, requestId, merchantOrderId, amount }, config);
  const data = await writeWithSameKeyInquiry({
    config,
    operation: "order.create",
    requestId,
    write: () => callSdk(config, "order", "create", params),
    inquiry: () => callSdk(config, "order", "inquiry", { paymentRequestId: requestId }),
    recover: (data) => recoverCreatedOrder(data),
  });
  const result = normalizeCreatedOrder(data);
  config.logger.info?.("[waffo] order.create 已确认", { requestId, productCode: input.productCode });
  return result;
}

async function inquiryOrder(input = {}, config) {
  const params = buildOrderInquiryParams(input);
  const data = await readOperation(config, "order.inquiry", "order", "inquiry", params);
  return normalizeOrderInquiry(data, input);
}

async function refundOrder(input = {}, config) {
  assertCurrency(input.currency);
  const amount = minorUsdToDecimal(input.amount);
  const refundRequestId = requiredText(input.refundRequestId, "WAFFO_INVALID_INPUT", "refundRequestId 不能为空");
  const acquiringOrderId = requiredText(input.acquiringOrderId, "WAFFO_INVALID_INPUT", "acquiringOrderId 不能为空");
  const reason = requiredText(input.reason, "WAFFO_INVALID_INPUT", "退款原因不能为空");
  const params = {
    refundRequestId,
    acquiringOrderId,
    refundAmount: amount,
    refundReason: reason,
    ...configOptionalFields(config, ["refundNotifyUrl"]),
  };
  const data = await writeWithSameKeyInquiry({
    config,
    operation: "order.refund",
    requestId: refundRequestId,
    write: () => callSdk(config, "order", "refund", params),
    inquiry: () => callSdk(config, "refund", "inquiry", { refundRequestId }),
    recover: (data) => recoverRefund(data),
  });
  const result = normalizeRefund(data);
  config.logger.info?.("[waffo] order.refund 已确认", { refundRequestId, acquiringOrderId });
  return result;
}

async function inquiryRefund(input = {}, config) {
  const params = buildRefundInquiryParams(input);
  const data = await readOperation(config, "refund.inquiry", "refund", "inquiry", params);
  return normalizeRefundInquiry(data, input);
}

async function createSubscription(input = {}, config) {
  assertCurrency(input.currency);
  const amount = minorUsdToDecimal(input.amount);
  const requestId = requiredText(input.requestId, "WAFFO_INVALID_INPUT", "订阅 requestId 不能为空");
  const merchantSubscriptionId = requiredText(
    input.merchantSubscriptionId,
    "WAFFO_INVALID_INPUT",
    "merchantSubscriptionId 不能为空",
  );
  const params = buildSubscriptionParams({ ...input, requestId, merchantSubscriptionId, amount }, config);
  const data = await writeWithSameKeyInquiry({
    config,
    operation: "subscription.create",
    requestId,
    write: () => callSdk(config, "subscription", "create", params),
    inquiry: () => callSdk(config, "subscription", "inquiry", { subscriptionRequest: requestId }),
    recover: (data) => recoverCreatedSubscription(data),
  });
  const result = normalizeCreatedSubscription(data);
  config.logger.info?.("[waffo] subscription.create 已确认", { requestId, productCode: input.productCode });
  return result;
}

async function inquirySubscription(input = {}, config) {
  const params = buildSubscriptionInquiryParams(input);
  const data = await readOperation(config, "subscription.inquiry", "subscription", "inquiry", params);
  return normalizeSubscriptionInquiry(data, input);
}

async function cancelSubscription(input = {}, config) {
  const externalSubscriptionId = requiredText(
    input.externalSubscriptionId,
    "WAFFO_INVALID_INPUT",
    "externalSubscriptionId 不能为空",
  );
  const requestId = requiredText(
    input.subscriptionRequest ?? input.requestId,
    "WAFFO_INVALID_INPUT",
    "subscriptionRequest 不能为空",
  );
  const data = await writeWithSameKeyInquiry({
    config,
    operation: "subscription.cancel",
    requestId,
    // 官方 cancel 只接受 subscriptionId；subscriptionRequest 仅用于同键 inquiry 恢复。
    write: () => callSdk(config, "subscription", "cancel", { subscriptionId: externalSubscriptionId }),
    inquiry: () => callSdk(config, "subscription", "inquiry", { subscriptionRequest: requestId }),
    recover: (data) => recoverCancelledSubscription(data),
  });
  const result = normalizeCancelledSubscription(data, externalSubscriptionId);
  config.logger.info?.("[waffo] subscription.cancel 已确认", { requestId, externalSubscriptionId });
  return result;
}

function buildOrderParams(input, config) {
  const product = resolveProduct(input.productCode, config);
  return {
    paymentRequestId: input.requestId,
    merchantOrderId: input.merchantOrderId,
    orderCurrency: input.currency,
    orderAmount: input.amount,
    orderDescription: product.description,
    userInfo: buildUserInfo(input, config),
    paymentInfo: buildPaymentInfo(ONE_TIME_PRODUCT_NAME, config.orderPayMethodType, config.orderPayMethodName),
    goodsInfo: product.goodsInfo,
    ...configOptionalFields(config, ["notifyUrl", "successRedirectUrl", "failedRedirectUrl", "cancelRedirectUrl"]),
  };
}

function buildSubscriptionParams(input, config) {
  const product = resolveProduct(input.productCode, config);
  return {
    subscriptionRequest: input.requestId,
    merchantSubscriptionId: input.merchantSubscriptionId,
    currency: input.currency,
    amount: input.amount,
    productInfo: {
      description: product.description,
      periodType: requiredText(input.periodType, "WAFFO_INVALID_INPUT", "订阅 periodType 不能为空"),
      periodInterval: normalizePeriodInterval(input.periodInterval),
    },
    userInfo: buildUserInfo(input, config),
    paymentInfo: buildPaymentInfo(SUBSCRIPTION_PRODUCT_NAME, config.subscriptionPayMethodType, config.subscriptionPayMethodName),
    goodsInfo: product.goodsInfo,
    ...configOptionalFields(config, [
      "notifyUrl", "successRedirectUrl", "failedRedirectUrl", "cancelRedirectUrl", "subscriptionManagementUrl",
    ]),
  };
}

function configOptionalFields(config, names) {
  return Object.fromEntries(names
    .filter((name) => config[name] !== undefined && config[name] !== null && config[name] !== "")
    .map((name) => [name, config[name]]));
}

/** 创建所有新 port 方法均稳定失败的 gateway，供缺少 SDK、凭证或 Sandbox 时 fail closed。 */
export function createUnavailableWaffoGateway(reason = "Waffo 未配置") {
  const fail = async () => { throw new ProviderError("WAFFO_UNAVAILABLE", reason); };
  return Object.freeze({
    createOrder: fail,
    inquiryOrder: fail,
    refundOrder: fail,
    createSubscription: fail,
    inquirySubscription: fail,
    cancelSubscription: fail,
    inquiryRefund: fail,
  });
}

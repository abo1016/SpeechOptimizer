import { HttpError } from "./errors.js";
import { route } from "./http-utils.js";
import { productCatalog, unknownProduct } from "./product-catalog.js";
import { resolveIdentity } from "./routes-auth.js";
import { createWaffoWebhookHandler } from "./waffo-webhook.js";

export async function handleBilling(context) {
  const { request, pathname, application, json, success } = context;
  if (request.method === "GET" && pathname === "/api/v1/plans") return success(200, productCatalog());
  if (request.method === "POST" && pathname === "/api/v1/webhooks/waffo") return webhook(context);
  const identity = () => accountIdentity(context);
  if (request.method === "GET" && pathname === "/api/v1/billing/balance") {
    const user = identity();
    return success(200, { minutes: application.entitlements.balance(user.id),
      reports: application.entitlements.balance(user.id, "report") });
  }
  if (request.method === "GET" && pathname === "/api/v1/billing/ledger") {
    const user = identity();
    return success(200, application.store.ledger.filter((row) => row.userId === user.id));
  }
  if (request.method === "POST" && pathname === "/api/v1/billing/orders") {
    const user = identity();
    const input = await json();
    const product = unknownProduct(input.productCode);
    const order = await application.billing.createOrder({ userId: user.id,
      productCode: input.productCode, amount: product.amount, currency: product.currency,
      userEmail: user.email, userCreatedAt: user.createdAt });
    await application.store.flush();
    return success(201, order);
  }
  if (request.method === "GET" && pathname === "/api/v1/billing/orders") {
    const user = identity();
    return success(200, [...application.store.orders.values()].filter((row) => row.userId === user.id));
  }
  if (request.method === "GET" && pathname === "/api/v1/billing/subscriptions") {
    const user = identity();
    return success(200, [...application.store.subscriptions.values()].filter((row) => row.userId === user.id));
  }
  let params = route(request.method, pathname, { method: "POST",
    path: /^\/api\/v1\/billing\/subscriptions\/(?<id>[^/]+)\/cancel$/ });
  if (params) return mutate(context, () => application.billing.cancelSubscription({ userId: identity().id, subscriptionId: params.id }));
  params = route(request.method, pathname, { method: "POST",
    path: /^\/api\/v1\/billing\/orders\/(?<id>[^/]+)\/refund$/ });
  if (params) return mutate(context, async () => application.billing.requestRefund({ userId: identity().id,
    orderId: params.id, reason: (await json()).reason ?? "requested_by_customer" }));
  return false;
}

async function webhook(context) {
  context.guardWebhook();
  const rawBody = (await context.raw(context.config.jsonLimitBytes)).toString("utf8");
  const signature = context.request.headers["x-signature"];
  const client = context.application.providers.waffoClient;
  if (!client || typeof client.webhook !== "function") {
    throw new HttpError("WAFFO_NOT_CONFIGURED", "Waffo Webhook client 未配置", 503);
  }
  const handler = createWaffoWebhookHandler(client, context.application);
  let result = await handler.handleWebhook(rawBody, signature);
  if (result.success) {
    try {
      await context.application.store.flush();
    } catch (error) {
      context.application.logger.error?.("waffo.webhook_persist_failed", { code: error.code ?? "PERSIST_FAILED" });
      result = failedSdkResponse(handler, "Webhook 持久化失败");
    }
  }
  return context.rawResponse(200, result.responseBody, { "X-SIGNATURE": result.responseSignature });
}

async function mutate(context, operation) {
  const result = await operation();
  await context.application.store.flush();
  return context.success(200, result);
}

function accountIdentity(context) {
  const identity = resolveIdentity(context.request, context.application, context.config);
  if (!identity.user) throw new HttpError("AUTHENTICATION_REQUIRED", "该操作需要登录账户", 401);
  return identity.user;
}

function failedSdkResponse(handler, message) {
  if (typeof handler.buildFailedResponse !== "function") {
    throw new HttpError("WAFFO_WEBHOOK_FAILED", message, 503);
  }
  const response = handler.buildFailedResponse(message);
  return { success: false, responseBody: response.body, responseSignature: response.signature, error: message };
}

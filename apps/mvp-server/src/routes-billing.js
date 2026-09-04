import { createHmac } from "node:crypto";
import { verifySignature } from "../../../spikes/sdk-integrations/src/webhook.js";
import { HttpError } from "./errors.js";
import { readBody, route } from "./http-utils.js";
import { productCatalog, unknownProduct } from "./application.js";
import { resolveIdentity } from "./routes-auth.js";

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
      productCode: input.productCode, amount: product.amount, currency: product.currency });
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
  const rawBody = await readBody(context.request, context.config.jsonLimitBytes);
  const signature = context.request.headers["x-waffo-signature"];
  if (!verifySignature(rawBody, signature, context.config.webhookSecret)) {
    throw new HttpError("INVALID_SIGNATURE", "Webhook 签名无效", 401);
  }
  let event;
  try { event = JSON.parse(rawBody.toString("utf8")); } catch {
    throw new HttpError("INVALID_PAYLOAD", "Webhook JSON 无效", 400);
  }
  const result = await context.application.billing.processWebhook(event);
  await context.application.store.flush();
  return context.success(200, result);
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

export function signWebhook(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

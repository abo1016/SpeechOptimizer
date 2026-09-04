import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook 处理器：验证签名、阻止重复事件，再将有效事件交给业务回调。
 */
export function verifySignature(rawBody, signature, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = String(signature ?? "");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function claimEvent(seenEvents, eventId) {
  if (!seenEvents || typeof eventId !== "string" || eventId.length === 0) return false;
  // Set.add 在无 await 的同步区间内完成占用，避免并发请求同时进入业务 sink。
  if (seenEvents instanceof Set) {
    if (seenEvents.has(eventId)) return false;
    seenEvents.add(eventId);
    return true;
  }
  if (typeof seenEvents.claim === "function") return seenEvents.claim(eventId);
  throw new TypeError("seenEvents 必须是 Set 或提供同步 claim(eventId) 方法");
}

function releaseEvent(seenEvents, eventId) {
  if (seenEvents instanceof Set) seenEvents.delete(eventId);
  else seenEvents.release?.(eventId);
}

export async function handleWebhook({ rawBody, signature, secret, eventId, seenEvents, onPayment, logger = console }) {
  if (!verifySignature(rawBody, signature, secret)) return { status: 401, body: { code: "INVALID_SIGNATURE" } };
  if (!claimEvent(seenEvents, eventId)) return { status: 200, body: { accepted: true, duplicate: true } };
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    releaseEvent(seenEvents, eventId);
    logger.warn?.(`[webhook] 非法 JSON event=${eventId}`);
    return { status: 400, body: { code: "INVALID_PAYLOAD" } };
  }
  if (!event || typeof event !== "object" || typeof event.type !== "string") {
    releaseEvent(seenEvents, eventId);
    logger.warn?.(`[webhook] payload 结构无效 event=${eventId}`);
    return { status: 400, body: { code: "INVALID_PAYLOAD" } };
  }
  logger.info?.(`[webhook] event=${event.type} id=${eventId}`);
  try {
    if (event.type === "PAYMENT_NOTIFICATION") await onPayment(event.data);
  } catch (error) {
    // 业务失败释放占用，让提供方稍后重试；成功占用则永久保留为幂等记录。
    releaseEvent(seenEvents, eventId);
    throw error;
  }
  return { status: 200, body: { accepted: true } };
}

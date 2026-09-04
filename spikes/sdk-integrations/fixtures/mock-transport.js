/**
 * 本地 Waffo mock transport：按 path 返回 fixture，永不访问网络或产生真实订单。
 */
export class MockTransport {
  constructor() { this.orders = new Map(); this.failNext = null; }
  async request({ path, body }) {
    if (this.failNext) { const failure = this.failNext; this.failNext = null; return failure; }
    if (path === "/orders") {
      const order = { status: "CREATED", acquiringOrderId: `mock-${body.requestId}`, checkoutUrl: "https://sandbox.invalid/checkout" };
      this.orders.set(body.requestId, order);
      return { ok: true, data: order };
    }
    if (path === "/orders/inquiry") return { ok: true, data: this.orders.get(body.requestId) ?? { status: "FAILED" } };
    if (path === "/orders/cancel" || path === "/refunds") return { ok: true, data: { status: "SUCCEEDED" } };
    return { ok: false, message: "unknown mock path" };
  }
}

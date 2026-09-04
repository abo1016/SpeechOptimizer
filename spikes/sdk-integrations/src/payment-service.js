import { DecisionRequiredError, UnknownStatusError } from "./errors.js";

/**
 * 业务层适配 Waffo：先登记本地意图，再调用外部服务，未知状态通过同一 requestId 查询恢复。
 */
export class PaymentService {
  constructor({ client, orderStore, logger = console, checkoutMode = "hosted" }) {
    this.client = client;
    this.orderStore = orderStore;
    this.logger = logger;
    this.checkoutMode = checkoutMode;
  }

  async purchaseMinutes({ userId, minutes, amount, currency = "USD" }) {
    if (!Number.isInteger(minutes) || minutes <= 0) throw new RangeError("minutes 必须为正整数");
    if (!Number.isInteger(amount) || amount <= 0) throw new RangeError("amount 必须为正整数最小货币单位");
    if (typeof currency !== "string" || currency.length !== 3) throw new RangeError("currency 必须为三字符币种代码");
    const local = await this.orderStore.create({ userId, minutes, amount, currency, status: "pending" });
    this.logger.info?.(`[billing] 创建订单 localId=${local.id}`);
    const requestId = local.requestId;
    try {
      const result = await this.client.createOrder({ requestId, amount, currency, productName: `minutes-${minutes}`, checkoutMode: this.checkoutMode });
      await this.orderStore.update(local.id, { status: "created", acquiringOrderId: result.acquiringOrderId, checkoutUrl: result.checkoutUrl });
      return { ...result, localOrderId: local.id };
    } catch (error) {
      if (error instanceof UnknownStatusError) {
        try {
          const recovered = await this.client.inquiryOrder({ requestId });
          await this.orderStore.update(local.id, { status: recovered.status, acquiringOrderId: recovered.acquiringOrderId });
          return { ...recovered, localOrderId: local.id, recovered: true };
        } catch (inquiryError) {
          // 查询也失败时不能留下 pending，否则重试无法区分未决状态与可重试失败。
          await this.orderStore.update(local.id, { status: "failed", errorCode: inquiryError.code ?? "WAFFO_INQUIRY_FAILED" });
          throw inquiryError;
        }
      }
      await this.orderStore.update(local.id, { status: "failed", errorCode: error.code });
      throw error;
    }
  }

  async subscriptionPreview() {
    throw new DecisionRequiredError("subscription mode (payment-first/service-first) 未确认");
  }
}

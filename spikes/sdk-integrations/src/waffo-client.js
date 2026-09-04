import { randomUUID } from "node:crypto";
import { ExternalServiceError, UnknownStatusError } from "./errors.js";

/**
 * 生成不超过 Waffo requestId 限制的幂等键；调用方也可以传入业务幂等键。
 */
export function createRequestId(prefix = "sp") {
  return `${prefix}-${randomUUID().replaceAll("-", "")}`.slice(0, 32);
}

/**
 * Waffo 客户端只依赖 transport 接口，生产环境可替换为官方 SDK，测试使用本地 fixture。
 */
export class WaffoClient {
  constructor({ transport, logger = console } = {}) {
    if (!transport || typeof transport.request !== "function") {
      throw new ExternalServiceError("Waffo 未配置 transport.request", { code: "WAFFO_NOT_CONFIGURED" });
    }
    this.transport = transport;
    this.logger = logger;
  }

  async createOrder(input) { return this.#write("order.create", input, "/orders"); }
  async cancelOrder(input) { return this.#write("order.cancel", input, "/orders/cancel"); }
  async refundOrder(input) { return this.#write("order.refund", input, "/refunds"); }
  async inquiryOrder(input) { return this.#read("order.inquiry", input, "/orders/inquiry"); }

  async #write(operation, input, path) {
    const requestId = input.requestId ?? createRequestId("so");
    const payload = { ...input, requestId };
    this.logger.info?.(`[waffo] ${operation} requestId=${requestId}`);
    try {
      const response = await this.transport.request({ method: "POST", path, body: payload });
      if (response?.unknownStatus) {
        throw new UnknownStatusError(`${operation} 状态未知`, { requestId });
      }
      if (!response?.ok) {
        throw new ExternalServiceError(response?.message ?? `${operation} 失败`, { requestId, retryable: response?.retryable });
      }
      return { ...response.data, requestId };
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError(`${operation} transport 异常`, { requestId, retryable: true, cause: error });
    }
  }

  async #read(operation, input, path) {
    const requestId = input.requestId ?? createRequestId("so");
    this.logger.info?.(`[waffo] ${operation} requestId=${requestId}`);
    try {
      const response = await this.transport.request({ method: "POST", path, body: { ...input, requestId } });
      if (!response?.ok) throw new ExternalServiceError(response?.message ?? `${operation} 失败`, { requestId, retryable: true });
      return { ...response.data, requestId };
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError(`${operation} transport 异常`, { requestId, retryable: true, cause: error });
    }
  }
}

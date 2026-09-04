import { randomUUID } from "node:crypto";

/**
 * 本地内存仓储只用于领域验证和开发环境，不承诺跨进程持久化。
 * 生产适配器必须用数据库事务替换，并保持 CONTRACT.md 中的唯一约束。
 */
export class MemoryStore {
  constructor() {
    this.users = new Map();
    this.usersByEmail = new Map();
    this.sessions = new Map();
    this.magicLinks = new Map();
    this.oauthStates = new Map();
    this.anonymousTrials = new Set();
    this.grants = new Map();
    this.holds = new Map();
    this.ledger = [];
    this.orders = new Map();
    this.subscriptions = new Map();
    // 退款请求与订单分开保存，Webhook 和管理员查询都需要用同一个退款引用回溯状态。
    this.refunds = new Map();
    this.webhookEvents = new Map();
    this.analyses = new Map();
    this.audit = [];
  }
}

/** ID 工厂允许测试注入固定序列，默认使用不可预测的 UUID。 */
export function createIdFactory(prefix = "id") {
  return () => `${prefix}_${randomUUID()}`;
}

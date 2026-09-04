import { invariant } from "./errors.js";

/** 管理服务要求调用方先完成 admin 角色鉴权，所有写操作同时追加审计记录。 */
export class AdminService {
  constructor({ store, entitlements, clock = () => Date.now(), id, logger = console }) {
    this.store = store;
    this.entitlements = entitlements;
    this.clock = clock;
    this.id = id;
    this.logger = logger;
  }

  userOverview(userId) {
    const user = this.store.users.get(userId);
    invariant(user, "USER_NOT_FOUND", "用户不存在");
    return {
      user,
      analyses: [...this.store.analyses.values()].filter((item) => item.userId === userId),
      subscriptions: [...this.store.subscriptions.values()].filter((item) => item.userId === userId),
      ledger: this.store.ledger.filter((item) => item.userId === userId),
      // 管理员查看账户时同时返回支付事件和分析失败状态，便于定位跨域业务问题。
      webhooks: [...this.store.webhookEvents.values()].filter((item) => this.#eventBelongsToUser(item, userId)),
      errors: [...this.store.analyses.values()]
        .filter((item) => item.userId === userId && item.status === "failed"),
    };
  }

  #eventBelongsToUser(event, userId) {
    if (event.userId === userId) return true;
    if (event.orderId && this.store.orders.get(event.orderId)?.userId === userId) return true;
    if (event.subscriptionId && this.store.subscriptions.get(event.subscriptionId)?.userId === userId) return true;
    return false;
  }

  disableAccount({ userId, actorId, reason }) {
    const user = this.store.users.get(userId);
    invariant(user, "USER_NOT_FOUND", "用户不存在");
    user.status = "disabled";
    this.#audit(actorId, "account.disable", userId, { reason });
    this.logger.warn?.(`[admin] account_disabled userId=${userId} actorId=${actorId}`);
    return user;
  }

  returnMinutes({ userId, minutes, actorId, reason }) {
    const grant = this.entitlements.adjust({ userId, amount: minutes, actorId, reason });
    this.#audit(actorId, "entitlement.return", userId, { minutes, reason, grantId: grant.id });
    this.logger.info?.(`[admin] minutes_returned userId=${userId} minutes=${minutes} actorId=${actorId}`);
    return grant;
  }

  #audit(actorId, action, targetId, details) {
    const record = { id: this.id(), actorId, action, targetId, details, createdAt: this.clock() };
    this.store.audit.push(record);
    return record;
  }
}

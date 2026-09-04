import { Check, Clock3, CreditCard, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { resources } from "../../api/resources.js";
import { logEvent } from "../../lib/logEvent.js";
import { money } from "../../lib/viewModels.js";
import { useApp } from "../../state/AppProvider.jsx";

/** 套餐价格与可售商品完全来自服务端目录，前端不维护可信金额或支付状态。 */
export function PricingContent() {
  const { bootError, booting, providerMode, session } = useApp();
  const [plans, setPlans] = useState({});
  const [checkout, setCheckout] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingProduct, setPendingProduct] = useState("");

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await resources.plans();
      setPlans(next);
      logEvent("billing.plans_loaded", { count: Object.keys(next).length });
    } catch (requestError) {
      setError(requestError.message || "Plans could not be loaded.");
      logEvent("billing.plans_failed", { code: requestError.code ?? "UNKNOWN" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!booting && !bootError) loadPlans(); }, [bootError, booting, loadPlans]);

  const order = async (productCode) => {
    if (!session?.user) {
      setError("Sign in before creating an order.");
      return;
    }
    setPendingProduct(productCode);
    setCheckout("");
    setError("");
    try {
      const created = await resources.createOrder(productCode);
      setCheckout(created.checkoutUrl ?? "");
      await loadPlans();
      logEvent("billing.order_created", { productCode, status: created.status });
    } catch (requestError) {
      setError(requestError.message || "The order could not be created.");
      logEvent("billing.order_create_failed", { productCode, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setPendingProduct("");
    }
  };

  if (booting) return <p className="empty-copy" aria-live="polite">Preparing your secure session…</p>;
  if (bootError) return <p className="empty-copy">Plans will load after the service connection is restored.</p>;
  if (loading) return <p className="empty-copy" aria-live="polite">Loading plans…</p>;

  const sellablePlans = Object.entries(plans).filter(([, plan]) => plan.amount > 0);
  return <><div className="pricing-grid">{sellablePlans.map(([code, plan], index) => <article className={index === 0 ? "plan-card is-featured" : "plan-card"} key={code}>{index === 0 && <span className="plan-label">Regular practice</span>}<h2>{productName(code)}</h2><strong>{money(plan.amount, plan.currency)}<small>{code.includes("monthly") ? "/month" : ""}</small></strong><p>{plan.minutes ? `${plan.minutes} analysis minutes` : `${plan.reports} deep report`}</p><ul><li><Check size={16} />Server-trusted price</li><li><Check size={16} />Secure order ownership</li><li><Check size={16} />Provider-confirmed status</li></ul><button className={index === 0 ? "button button-primary" : "button button-secondary"} disabled={Boolean(pendingProduct)} onClick={() => order(code)}>{pendingProduct === code ? "Creating order" : "Create order"}</button></article>)}</div>{checkout && <p className="dialog-message" role="status">Order created. <a href={checkout} target="_blank" rel="noreferrer">Continue to checkout</a>{providerMode === "mock" ? " (local development provider; no charge is made)." : "."}</p>}{error && <div role="alert"><p className="form-error">{error}</p>{Object.keys(plans).length === 0 && <button className="text-button" onClick={loadPlans}>Try again</button>}</div>}</>;
}

/** 账单页仅在账户会话就绪后读取余额、订单、订阅和流水，避免匿名请求制造错误态。 */
export function BillingContent() {
  const { bootError, booting, providerMode, session } = useApp();
  const [data, setData] = useState({ balance: null, ledger: [], orders: [], subscriptions: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState("");
  const userId = session?.user?.id;
  const signedIn = Boolean(userId);

  const load = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    setError("");
    try {
      const [balance, ledger, orders, subscriptions] = await Promise.all([resources.balance(), resources.ledger(), resources.orders(), resources.subscriptions()]);
      setData({ balance, ledger, orders, subscriptions });
      logEvent("billing.account_loaded", { orders: orders.length, subscriptions: subscriptions.length });
    } catch (requestError) {
      setError(requestError.message || "Billing data could not be loaded.");
      logEvent("billing.account_load_failed", { code: requestError.code ?? "UNKNOWN" });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (!booting && !bootError && signedIn) load(); }, [bootError, booting, load, signedIn, userId]);

  const mutate = async (key, operation) => {
    setPending(key);
    setError("");
    try {
      await operation();
      await load();
      logEvent("billing.account_mutation_completed", { action: key });
    } catch (requestError) {
      setError(requestError.message || "The billing action could not be completed.");
      logEvent("billing.account_mutation_failed", { action: key, code: requestError.code ?? "UNKNOWN" });
    } finally {
      setPending("");
    }
  };

  if (booting) return <p className="empty-copy" aria-live="polite">Preparing your secure session…</p>;
  if (bootError) return <p className="empty-copy">Billing will load after the service connection is restored.</p>;
  if (!signedIn) return <div className="empty-state"><ShieldCheck size={24} aria-hidden="true" /><h2>Sign in to manage billing</h2><p>Your balance, orders, subscriptions, and ledger are available only to your account.</p></div>;

  return <div className="settings-layout"><section className="settings-main" aria-busy={loading}><div className="balance-panel"><span><Clock3 size={22} />Minutes available</span><strong>{data.balance?.minutes ?? "--"}</strong><p>{data.balance?.reports ?? 0} report credits available.</p><div className="wide-meter"><span style={{ width: `${Math.min(Math.max(data.balance?.minutes ?? 0, 0), 100)}%` }} /></div></div><BillingLists data={data} pending={pending} mutate={mutate} />{loading && <p className="empty-copy" aria-live="polite">Refreshing billing data…</p>}{error && <div role="alert"><p className="form-error">{error}</p><button className="text-button" disabled={Boolean(pending)} onClick={load}>Try again</button></div>}</section><aside className="info-panel"><ShieldCheck size={22} /><h2>{providerMode === "mock" ? "Local development provider" : "Configured payment provider"}</h2><p>{providerMode === "mock" ? "Development orders use a local provider and do not charge a payment method." : "Checkout, cancellation, refund, and webhook status come from the configured provider."}</p><RefreshCw size={18} /></aside></div>;
}

function BillingLists({ data, mutate, pending }) {
  return <div className="billing-list"><h2>Subscriptions</h2>{data.subscriptions.length ? data.subscriptions.map((subscription) => <div className="ledger-row" key={subscription.id}><span><strong>{subscription.productCode}</strong><small>{subscription.id}</small></span><span className={`status-chip is-${subscription.status}`}>{subscription.status}</span>{subscription.status === "active" && <button className="text-button" disabled={Boolean(pending)} onClick={() => mutate(`cancel:${subscription.id}`, () => resources.cancelSubscription(subscription.id))}>{pending === `cancel:${subscription.id}` ? "Cancelling" : "Cancel subscription"}</button>}</div>) : <p className="empty-copy">No subscriptions yet.</p>}<h2>Orders</h2>{data.orders.length ? data.orders.map((order) => <div className="ledger-row" key={order.id}><span><strong>{order.productCode}</strong><small>{order.id}</small></span><span className={`status-chip is-${order.status}`}>{order.status}</span><span>{money(order.amount, order.currency)}</span>{order.status === "paid" && <button className="text-button" disabled={Boolean(pending)} onClick={() => mutate(`refund:${order.id}`, () => resources.refundOrder(order.id, "requested_by_customer"))}>{pending === `refund:${order.id}` ? "Requesting refund" : "Request refund"}</button>}{order.failureCode && <small className="danger-text">{order.failureCode}</small>}</div>) : <p className="empty-copy">No orders yet.</p>}<h2>Minute ledger</h2>{data.ledger.length ? data.ledger.slice().reverse().map((entry) => <div className="ledger-row" key={entry.id}><span><strong>{entry.type}</strong><small>{entry.referenceId}</small></span><span>{entry.amount > 0 ? "+" : ""}{entry.amount} {entry.unit}</span></div>) : <p className="empty-copy">No ledger entries yet.</p>}</div>;
}

function productName(code) {
  return code.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

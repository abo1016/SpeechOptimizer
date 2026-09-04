import { Environment, RsaUtils, Waffo, WaffoUnknownStatusError } from "@waffo/waffo-node";
import { createFixtureSttProvider } from "../../../packages/speech-engine/src/index.js";
import { MockGoogleProvider, MockWaffoGateway } from "../../../services/account-billing/fixtures/local-adapters.js";
import { createFetchTransport, createOpenAiFeedbackProvider, createOpenAiSttProvider,
  createWaffoGateway, LocalCaptureMagicLinkSender, SmtpMagicLinkSender }
  from "../../../packages/provider-adapters/src/index.js";

const FIXTURE_WORDS = ["Today", "I", "want", "to", "share", "one", "clear", "idea", "for", "your", "next", "recording"];

/** 组装外接服务边界；开发替身和生产网络适配器在类型与日志上明确区分。 */
export function createProviders(config, logger, fetchImpl = fetch, external = {}) {
  if (config.mode !== "production") return createDevelopmentProviders(logger, external);
  if (!external.smtpTransport) throw new Error("生产模式必须注入 SMTP transport");
  const waffoClient = createWaffoClient(config, logger, external.waffoClient, external.waffoHttpTransport);
  const isUnknownStatusError = external.isUnknownStatusError ?? defaultIsUnknownStatusError;
  const transport = createFetchTransport(fetchImpl);
  return {
    mode: "production",
    mailer: new SmtpMagicLinkSender({ transport: external.smtpTransport, from: config.smtpFrom, logger }),
    oauthProvider: createGoogleProvider(config, fetchImpl),
    sttProvider: createOpenAiSttProvider({ apiKey: config.openAiApiKey,
      endpoint: config.openAiSttUrl, transport, logger }),
    feedbackProvider: createOpenAiFeedbackProvider({ apiKey: config.openAiApiKey,
      endpoint: config.openAiFeedbackUrl, model: config.openAiFeedbackModel, transport, logger }),
    waffoClient,
    isUnknownStatusError,
    waffoGateway: external.waffoGateway ?? createWaffoGateway({
      client: waffoClient,
      isUnknownStatusError,
      productIds: config.waffoProductIds,
      goodsName: config.waffoGoodsName,
      goodsUrl: config.waffoGoodsUrl,
      notifyUrl: config.waffoNotifyUrl,
      refundNotifyUrl: config.waffoRefundNotifyUrl,
      successRedirectUrl: config.waffoSuccessRedirectUrl,
      failedRedirectUrl: config.waffoFailedRedirectUrl,
      cancelRedirectUrl: config.waffoCancelRedirectUrl,
      subscriptionManagementUrl: config.waffoSubscriptionManagementUrl,
      userTerminal: config.waffoUserTerminal,
      logger,
    }),
  };
}

function createDevelopmentProviders(logger, external) {
  const localWaffo = external.waffoClient
    ? { client: external.waffoClient, signWebhook: external.waffoWebhookSigner }
    : createLocalWaffoClient(logger);
  const isUnknownStatusError = external.isUnknownStatusError ?? defaultIsUnknownStatusError;
  return {
    mode: "mock",
    mailer: new LocalCaptureMagicLinkSender({ logger }),
    oauthProvider: new MockGoogleProvider(),
    sttProvider: createFixtureSttProvider(createTranscript()),
    waffoClient: localWaffo.client,
    waffoWebhookSigner: localWaffo.signWebhook,
    isUnknownStatusError,
    waffoGateway: external.waffoGateway ?? new MockWaffoGateway(),
  };
}

/**
 * 创建官方 SDK 3.0.1 client；测试可以注入已构造的 client，避免网络和密钥出现在测试代码中。
 * SDK logger 只接收无参数安全事件，刻意丢弃 SDK 可能携带 request/response body 的调试参数。
 */
export function createWaffoClient(config, logger, injectedClient, httpTransport) {
  if (injectedClient) return injectedClient;
  const client = new Waffo({
    apiKey: config.waffoApiKey,
    privateKey: config.waffoPrivateKey,
    waffoPublicKey: config.waffoPublicKey,
    environment: config.waffoEnvironment === "PRODUCTION" ? Environment.PRODUCTION : Environment.SANDBOX,
    merchantId: config.waffoMerchantId,
    httpTransport,
    logger: createSafeWaffoLogger(logger),
  });
  logger.info?.("waffo.client_created", { environment: config.waffoEnvironment, injected: false });
  return client;
}

/** 开发模式使用一次性内存密钥，只为本地验收 SDK Webhook 的签名往返，不代表 Sandbox 凭证。 */
function createLocalWaffoClient(logger) {
  const keyPair = RsaUtils.generateKeyPair();
  const client = new Waffo({
    apiKey: "local-development-only",
    privateKey: keyPair.privateKey,
    waffoPublicKey: keyPair.publicKey,
    environment: Environment.SANDBOX,
    merchantId: "local-development-only",
    logger: createSafeWaffoLogger(logger),
  });
  logger.info?.("waffo.local_client_created", { environment: "SANDBOX" });
  return { client, signWebhook: (body) => RsaUtils.sign(body, keyPair.privateKey) };
}

/** 默认未知状态只识别官方 SDK 异常；不能把普通业务失败误判为可 inquiry 的不确定状态。 */
export function defaultIsUnknownStatusError(error) {
  return error instanceof WaffoUnknownStatusError;
}

function createSafeWaffoLogger(logger) {
  return Object.freeze({
    debug() {},
    info() { logger.debug?.("waffo.sdk_info"); },
    warn() { logger.warn?.("waffo.sdk_warning"); },
    error() { logger.error?.("waffo.sdk_error"); },
  });
}

function createTranscript() {
  return {
    language: "en-US", durationSeconds: 30,
    words: FIXTURE_WORDS.map((text, index) => ({
      text, startSeconds: index * 1.5, endSeconds: index * 1.5 + 0.6, confidence: 0.96,
    })),
    estimatedCostUsd: 0, processingDurationMs: 1,
  };
}

function createGoogleProvider(config, fetchImpl) {
  return {
    createAuthorizationUrl({ state, redirectUri }) {
      const query = new URLSearchParams({ client_id: config.googleClientId, redirect_uri: redirectUri,
        response_type: "code", scope: "openid email", state });
      return `${config.googleAuthorizeUrl}?${query}`;
    },
    async exchangeCode({ code, redirectUri }) {
      const response = await fetchImpl(config.googleTokenUrl, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, redirectUri, clientId: config.googleClientId, clientSecret: config.googleClientSecret }) });
      if (!response.ok) throw Object.assign(new Error("Google OAuth 交换失败"), { code: "OAUTH_EXCHANGE_FAILED" });
      return response.json();
    },
  };
}

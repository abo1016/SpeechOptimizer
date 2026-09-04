import { createFixtureSttProvider } from "../../../packages/speech-engine/src/index.js";
import { MockGoogleProvider, MockWaffoGateway } from "../../../services/account-billing/fixtures/local-adapters.js";
import { createFetchTransport, createOpenAiFeedbackProvider, createOpenAiSttProvider,
  createWaffoGateway, LocalCaptureMagicLinkSender, SmtpMagicLinkSender }
  from "../../../packages/provider-adapters/src/index.js";

const FIXTURE_WORDS = ["Today", "I", "want", "to", "share", "one", "clear", "idea", "for", "your", "next", "recording"];

/** 组装外接服务边界；开发替身和生产网络适配器在类型与日志上明确区分。 */
export function createProviders(config, logger, fetchImpl = fetch, external = {}) {
  if (config.mode !== "production") return createDevelopmentProviders(logger);
  if (!external.waffoClient) throw new Error("生产模式必须注入官方 Waffo client");
  if (!external.smtpTransport) throw new Error("生产模式必须注入 SMTP transport");
  const transport = createFetchTransport(fetchImpl);
  return {
    mode: "production",
    mailer: new SmtpMagicLinkSender({ transport: external.smtpTransport, from: config.smtpFrom, logger }),
    oauthProvider: createGoogleProvider(config, fetchImpl),
    sttProvider: createOpenAiSttProvider({ apiKey: config.openAiApiKey,
      endpoint: config.openAiSttUrl, transport, logger }),
    feedbackProvider: createOpenAiFeedbackProvider({ apiKey: config.openAiApiKey,
      endpoint: config.openAiFeedbackUrl, model: config.openAiFeedbackModel, transport, logger }),
    waffoGateway: createWaffoGateway({ client: external.waffoClient,
      productIds: config.waffoProductIds, successUrl: config.waffoSuccessUrl, logger }),
  };
}

function createDevelopmentProviders(logger) {
  return {
    mode: "mock",
    mailer: new LocalCaptureMagicLinkSender({ logger }),
    oauthProvider: new MockGoogleProvider(),
    sttProvider: createFixtureSttProvider(createTranscript()),
    waffoGateway: new MockWaffoGateway(),
  };
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

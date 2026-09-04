import test from "node:test";
import assert from "node:assert/strict";
import { AuthService, BillingService, MemoryStore } from "../../../services/account-billing/src/index.js";
import { ServerMediaInspector } from "../../../services/core-platform/src/index.js";
import { resolveFeedback, runTranscription } from "../../speech-engine/src/index.js";
import { openAiFeedbackFixture } from "../fixtures/openai-feedback.js";
import { openAiTranscriptionFixture } from "../fixtures/openai-transcription.js";
import {
  createFfprobeMediaAdapter, createOpenAiFeedbackProvider, createOpenAiSttProvider,
  createWaffoGateway, LocalCaptureMagicLinkSender,
} from "../src/index.js";

const logger = { info() {}, warn() {}, error() {} };

test("OpenAI adapters 通过 speech-engine 的真实 provider 门禁", async () => {
  const stt = createOpenAiSttProvider({
    apiKey: "test", logger,
    transport: { async request() { return { status: 200, body: openAiTranscriptionFixture }; } },
  });
  const transcript = await runTranscription(stt, { bytes: Buffer.from("audio") });
  const feedback = createOpenAiFeedbackProvider({
    apiKey: "test", logger,
    transport: { async request() { return { status: 200, body: openAiFeedbackFixture }; } },
  });
  const result = await resolveFeedback({ wordsPerMinute: 100, lowConfidenceSegments: [], fillers: { total: 0, occurrences: [] }, longPauses: [], repeatedPhrases: [] }, feedback, { transcript, logger });
  assert.equal(transcript.provider, "openai-whisper-1");
  assert.equal(result.source, "openai-gpt-4o-mini");
});

test("ffprobe durationResolver 通过 core-platform 的真实媒体边界", async () => {
  const bytes = Buffer.from("0000ftypM4A ");
  const adapter = createFfprobeMediaAdapter({
    logger,
    runCommand: async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "30.5" } }) }),
  });
  const result = await new ServerMediaInspector({ durationResolver: adapter.durationResolver }).inspect(bytes);
  assert.deepEqual(result, { mime: "audio/mp4", extension: "m4a", durationMs: 30500 });
});

test("Waffo gateway 通过 account-billing 的真实订单边界", async () => {
  const store = new MemoryStore();
  const client = {
    order() {
      return { async create() {
        return apiSuccess({ acquiringOrderId: "AO_1", orderAction: JSON.stringify({ webUrl: "https://checkout.example" }) });
      } };
    },
  };
  const gateway = createWaffoGateway({
    client,
    productIds: { minutes_30: "PROD_1" },
    productNames: { minutes_30: "30 Minutes" },
    productUrls: { minutes_30: "https://merchant.example/minutes" },
    notifyUrl: "https://merchant.example/webhook",
    successRedirectUrl: "https://merchant.example/success",
    userTerminal: "WEB",
    logger,
  });
  const billing = new BillingService({ store, entitlements: {}, gateway, id: () => "order-1", logger });
  const order = await billing.createOrder({ userId: "user-1", userEmail: "user@example.com", productCode: "minutes_30", amount: 600 });
  assert.equal(order.status, "created");
  assert.equal(order.acquiringOrderId, "AO_1");
});

function apiSuccess(data) {
  return { isSuccess: () => true, getData: () => data, getCode: () => "0", getMessage: () => undefined };
}

test("本地 Magic Link sender 通过 account-billing 的真实认证边界", async () => {
  const store = new MemoryStore();
  const mailer = new LocalCaptureMagicLinkSender({ logger });
  const auth = new AuthService({
    store, mailer, id: () => "user-1", logger, exposeDevTokens: true,
    allowedRedirectOrigins: ["http://localhost"],
  });
  const result = await auth.requestMagicLink({ email: "user@example.com", redirectUri: "http://localhost/auth" });
  assert.equal(result.accepted, true);
  assert.equal(mailer.messages.length, 1);
});

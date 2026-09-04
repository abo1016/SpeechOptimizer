import assert from "node:assert/strict";
import test from "node:test";
import { calculateMetrics, resolveFeedback } from "../src/index.js";
import { englishSpeechFixture } from "./fixtures/english-speech.js";

const metrics = calculateMetrics(englishSpeechFixture);
const silentLogger = { warn() {} };

test("低置信输入优先返回带时间证据的可执行建议，且总数不超过三条", async () => {
  const result = await resolveFeedback(metrics);
  assert.equal(result.items.length, 3);
  assert.match(result.items[0].issue, /transcribed reliably/i);
  assert.match(result.items[0].evidence, /15\.6s.*16\.8s/);
  for (const item of result.items) {
    assert.ok(item.issue && item.evidence && item.revision && item.rerecordPrompt);
  }
});

test("结构化输出失败时降级为确定性反馈", async () => {
  const provider = { name: "broken-feedback", async generate() { return { items: { issue: "wrong shape" } }; } };
  const result = await resolveFeedback(metrics, provider, { logger: silentLogger });
  assert.equal(result.source, "deterministic-fallback");
  assert.equal(result.fallbackReason, "INVALID_FEEDBACK");
  assert.equal(result.items.length, 3);
});

test("反馈超时后降级且不会向外抛出供应商异常", async () => {
  const provider = {
    name: "slow-feedback",
    // 故意忽略 AbortSignal，验证超时边界不依赖供应商合作。
    async generate() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { items: [] };
    },
  };
  const result = await resolveFeedback(metrics, provider, { timeoutMs: 5, logger: silentLogger });
  assert.equal(result.source, "deterministic-fallback");
  assert.equal(result.fallbackReason, "timeout");
});

test("包含心理、人格或医疗判断的供应商内容被安全边界拦截", async () => {
  const provider = {
    name: "unsafe-feedback",
    async generate() {
      return {
        items: [{
          priority: "high",
          issue: "The speaker has an anxious personality.",
          evidence: "The recording sounds anxious.",
          revision: "Speak normally.",
          rerecordPrompt: "Try again.",
        }],
      };
    },
  };
  const result = await resolveFeedback(metrics, provider, { logger: silentLogger });
  assert.equal(result.source, "deterministic-fallback");
  assert.equal(result.fallbackReason, "UNSAFE_FEEDBACK");
  assert.doesNotMatch(JSON.stringify(result.items), /anxious personality/i);
});

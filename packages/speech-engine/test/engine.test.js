import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSpeech, createFixtureSttProvider } from "../src/index.js";
import { englishSpeechFixture } from "./fixtures/english-speech.js";

const silentLogger = { info() {}, warn() {}, error() {} };

test("统一分析接口返回指标、三条反馈、成本和分阶段处理时长", async () => {
  const result = await analyzeSpeech(
    { fixtureId: "english-speech" },
    { sttProvider: createFixtureSttProvider(englishSpeechFixture), logger: silentLogger },
  );
  assert.equal(result.version, "speech-engine/v1");
  assert.equal(result.metrics.wordCount, 54);
  assert.equal(result.feedback.length, 3);
  assert.equal(result.usage.estimatedCostUsd, 0.006);
  assert.equal(result.usage.estimatedTwoMinuteCostUsd, 0.024);
  assert.equal(result.usage.stages.transcription.processingDurationMs, 420);
  assert.equal(result.usage.stages.feedback.estimatedCostUsd, 0);
  assert.ok(result.usage.processingDurationMs >= 0);
});

test("外部反馈成功时记录独立成本和处理时长", async () => {
  const feedbackProvider = {
    name: "fixture-feedback",
    async generate({ transcript, metrics }) {
      assert.equal(transcript.words.length, metrics.wordCount);
      return {
        items: [{
          priority: "low",
          issue: "One phrase repeats.",
          evidence: "The phrase appears twice.",
          revision: "Keep one occurrence.",
          rerecordPrompt: "State the point once and add an example.",
        }],
        estimatedCostUsd: 0.002,
        processingDurationMs: 80,
      };
    },
  };
  const result = await analyzeSpeech({}, {
    sttProvider: createFixtureSttProvider(englishSpeechFixture),
    feedbackProvider,
    logger: silentLogger,
  });
  assert.equal(result.feedbackMetadata.source, "fixture-feedback");
  assert.equal(result.usage.estimatedCostUsd, 0.008);
  assert.equal(result.usage.stages.feedback.processingDurationMs, 80);
});

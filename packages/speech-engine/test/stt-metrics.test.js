import assert from "node:assert/strict";
import test from "node:test";
import { calculateMetrics, createFixtureSttProvider, runTranscription, SpeechEngineError } from "../src/index.js";
import { englishSpeechFixture } from "./fixtures/english-speech.js";

test("固定英语夹具可重复产生逐词转写和确定性指标", async () => {
  const provider = createFixtureSttProvider(englishSpeechFixture);
  const first = await runTranscription(provider, { fixtureId: "english-speech" });
  const second = await runTranscription(provider, { fixtureId: "english-speech" });
  assert.deepEqual(first, second);

  const metrics = calculateMetrics(first);
  assert.deepEqual(metrics, {
    totalDurationSeconds: 30,
    effectiveSpeakingSeconds: 14.7,
    wordCount: 54,
    wordsPerMinute: 220.4,
    fillers: {
      total: 4,
      perMinute: 16.3,
      occurrences: [
        { phrase: "um", atSeconds: 3.5 },
        { phrase: "you know", atSeconds: 3.8 },
        { phrase: "like", atSeconds: 14.6 },
        { phrase: "like", atSeconds: 14.95 },
      ],
    },
    longPauses: [{ startSeconds: 6.55, endSeconds: 10.1, durationSeconds: 3.55 }],
    repeatedPhrases: [
      { phrase: "the first step is", count: 2, wordIndexes: [12, 20] },
      { phrase: "first step is to", count: 2, wordIndexes: [13, 21] },
      { phrase: "step is to write", count: 2, wordIndexes: [14, 22] },
      { phrase: "is to write the", count: 2, wordIndexes: [15, 23] },
      { phrase: "to write the goal", count: 2, wordIndexes: [16, 24] },
    ],
    sentenceLengths: { count: 5, averageWords: 10.8, maximumWords: 14, values: [9, 11, 14, 8, 12] },
    lowConfidenceSegments: [{ startSeconds: 15.6, endSeconds: 16.75, confidence: 0.58, wordCount: 3 }],
  });
});

test("STT 超时转换为可重试的稳定错误", async () => {
  // 故意忽略 AbortSignal，验证引擎本身仍能按时结束等待。
  const provider = { name: "non-cooperative-stt", async transcribe() {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return englishSpeechFixture;
  } };
  await assert.rejects(
    runTranscription(provider, {}, { timeoutMs: 5 }),
    (error) => error instanceof SpeechEngineError && error.code === "STT_TIMEOUT" && error.retryable,
  );
});

test("非法语言和逐词时间戳会在指标计算前被拒绝", async () => {
  const fixture = structuredClone(englishSpeechFixture);
  fixture.language = "zh-CN";
  const provider = createFixtureSttProvider(fixture);
  await assert.rejects(runTranscription(provider, {}), { code: "UNSUPPORTED_LANGUAGE" });
});

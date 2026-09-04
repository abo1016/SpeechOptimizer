/** 固定语音处理 fixture：测试不访问网络，也不会把音频或转写写入日志。 */
export class MockSpeechProcessor {
  constructor({ failure, waitFor } = {}) {
    this.failure = failure;
    this.waitFor = waitFor;
    this.calls = [];
  }

  async transcribe({ analysisId, media }) {
    this.calls.push({ operation: "transcribe", analysisId, media });
    if (this.waitFor) await this.waitFor;
    if (this.failure === "transcribe") throw retryableError("STT_TEMPORARY_ERROR");
    return { text: "A short fixture transcript.", words: [{ text: "fixture", startMs: 500 }] };
  }

  async analyze({ analysisId }) {
    this.calls.push({ operation: "analyze", analysisId });
    if (this.failure === "analyze") throw retryableError("LLM_TEMPORARY_ERROR");
    return { metrics: { wpm: 112 }, suggestions: [{ priority: 1, message: "Pause after the opening." }] };
  }
}

function retryableError(code) {
  return Object.assign(new Error(code), { code, retryable: true });
}

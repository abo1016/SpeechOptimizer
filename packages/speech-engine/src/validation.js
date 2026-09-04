import { SpeechEngineError } from "./errors.js";

const ENGLISH_LANGUAGE_PATTERN = /^en(?:-|$)/i;
// 允许供应商浮点舍入造成最多 50 毫秒的尾部偏差。
const DURATION_TOLERANCE_SECONDS = 0.05;

function assertFiniteNumber(value, field) {
  if (!Number.isFinite(value)) {
    throw new SpeechEngineError("INVALID_TRANSCRIPT", `${field} 必须是有限数字`);
  }
}

function validateWord(word, index, previousEnd) {
  if (!word || typeof word.text !== "string" || !word.text.trim()) {
    throw new SpeechEngineError("INVALID_TRANSCRIPT", `words[${index}].text 无效`);
  }
  assertFiniteNumber(word.startSeconds, `words[${index}].startSeconds`);
  assertFiniteNumber(word.endSeconds, `words[${index}].endSeconds`);
  assertFiniteNumber(word.confidence, `words[${index}].confidence`);
  if (word.startSeconds < 0 || word.endSeconds < word.startSeconds) {
    throw new SpeechEngineError("INVALID_TRANSCRIPT", `words[${index}] 时间戳无效`);
  }
  if (word.startSeconds < previousEnd || word.confidence < 0 || word.confidence > 1) {
    throw new SpeechEngineError("INVALID_TRANSCRIPT", `words[${index}] 顺序或置信度无效`);
  }
}

export function validateTranscript(transcript) {
  if (!transcript || !ENGLISH_LANGUAGE_PATTERN.test(transcript.language ?? "")) {
    throw new SpeechEngineError("UNSUPPORTED_LANGUAGE", "MVP 语音引擎仅支持英语");
  }
  assertFiniteNumber(transcript.durationSeconds, "durationSeconds");
  assertFiniteNumber(transcript.estimatedCostUsd, "estimatedCostUsd");
  assertFiniteNumber(transcript.processingDurationMs, "processingDurationMs");
  if (transcript.durationSeconds <= 0 || transcript.estimatedCostUsd < 0) {
    throw new SpeechEngineError("INVALID_TRANSCRIPT", "时长和成本字段无效");
  }
  if (transcript.processingDurationMs < 0 || typeof transcript.provider !== "string" || !transcript.provider) {
    throw new SpeechEngineError("INVALID_TRANSCRIPT", "处理时长或 provider 字段无效");
  }
  if (!Array.isArray(transcript.words) || transcript.words.length === 0) {
    throw new SpeechEngineError("INVALID_TRANSCRIPT", "逐词转写不能为空");
  }
  let previousEnd = 0;
  transcript.words.forEach((word, index) => {
    validateWord(word, index, previousEnd);
    previousEnd = word.endSeconds;
  });
  if (previousEnd > transcript.durationSeconds + DURATION_TOLERANCE_SECONDS) {
    throw new SpeechEngineError("INVALID_TRANSCRIPT", "逐词时间戳超出音频总时长");
  }
  return transcript;
}

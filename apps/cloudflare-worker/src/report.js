const FILLERS = new Set(["um", "uh", "like", "actually", "basically"]);

/** 将 OpenAI word timestamp 归一为现有前端可读的 transcript/metrics 结构。 */
export function buildReport(transcription) {
  const words = normalizeWords(transcription);
  const durationSeconds = Number(transcription.duration ?? words.at(-1)?.endSeconds ?? 0);
  const transcript = {
    text: String(transcription.text ?? ""),
    durationSeconds,
    words,
    provider: "openai-whisper-1",
    estimatedCostUsd: 0,
    processingDurationMs: 0,
  };
  const metrics = calculateMetrics(transcript);
  return {
    transcript,
    report: {
      version: "speech-engine/v1",
      transcript,
      metrics,
      feedback: deterministicFeedback(metrics),
      feedbackMetadata: { source: "deterministic-cloudflare", fallbackReason: null },
      usage: { estimatedCostUsd: 0, estimatedTwoMinuteCostUsd: 0, processingDurationMs: 0, stages: {} },
    },
  };
}

function normalizeWords(transcription) {
  const source = Array.isArray(transcription.words) ? transcription.words : [];
  return source.map((word) => ({
    text: String(word.word ?? word.text ?? "").trim(),
    startSeconds: Number(word.start ?? word.startSeconds ?? 0),
    endSeconds: Number(word.end ?? word.endSeconds ?? word.start ?? 0),
    confidence: Number.isFinite(word.confidence) ? word.confidence : 1,
  })).filter((word) => word.text);
}

function calculateMetrics(transcript) {
  const words = transcript.words;
  const effectiveSpeakingSeconds = round(words.reduce((sum, word) => sum + Math.max(0, word.endSeconds - word.startSeconds), 0));
  const minutes = effectiveSpeakingSeconds / 60;
  const fillerOccurrences = words.filter((word) => FILLERS.has(normalize(word.text)))
    .map((word) => ({ phrase: normalize(word.text), atSeconds: word.startSeconds }));
  return {
    totalDurationSeconds: round(transcript.durationSeconds),
    effectiveSpeakingSeconds,
    wordCount: words.length,
    wordsPerMinute: minutes > 0 ? round(words.length / minutes, 1) : 0,
    fillers: { total: fillerOccurrences.length, perMinute: minutes > 0 ? round(fillerOccurrences.length / minutes, 1) : 0,
      occurrences: fillerOccurrences },
    longPauses: longPauses(words),
    repeatedPhrases: [],
    sentenceLengths: { count: 0, averageWords: 0, maximumWords: 0, values: [] },
    lowConfidenceSegments: [],
  };
}

function longPauses(words) {
  const pauses = [];
  for (let index = 1; index < words.length; index += 1) {
    const durationSeconds = words[index].startSeconds - words[index - 1].endSeconds;
    if (durationSeconds > 3) pauses.push({ startSeconds: words[index - 1].endSeconds,
      endSeconds: words[index].startSeconds, durationSeconds: round(durationSeconds) });
  }
  return pauses;
}

function deterministicFeedback(metrics) {
  const items = [];
  if (metrics.wordsPerMinute > 175) items.push(item("high", "The delivery is too fast for easy scanning.",
    `The measured pace is ${metrics.wordsPerMinute} words per minute.`, "Shorten long sentences and add a brief beat after each key point."));
  if (metrics.fillers.total >= 2) items.push(item("medium", "Repeated filler words interrupt the message.",
    `${metrics.fillers.total} fillers were found.`, "Replace each filler with a silent beat before the next clause."));
  if (metrics.longPauses.length) items.push(item("medium", "A long pause breaks continuity.",
    `A ${metrics.longPauses[0].durationSeconds}s pause was measured.`, "Use a short transition phrase or reduce the pause."));
  return items.slice(0, 3);
}

function item(priority, issue, evidence, revision) {
  return { priority, issue, evidence, revision, rerecordPrompt: "Rerecord the same idea once with the suggested change." };
}

function normalize(value) { return value.toLowerCase().replace(/[^a-z']/g, ""); }
function round(value, digits = 2) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }

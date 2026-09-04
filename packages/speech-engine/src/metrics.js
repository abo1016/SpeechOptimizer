const DEFAULT_FILLERS = ["you know", "i mean", "kind of", "sort of", "um", "uh", "like", "actually", "basically"];
// 重复短语使用 2-4 词窗口；更长窗口对短口播过于稀疏，更短窗口噪声过大。
const MIN_REPEAT_WORDS = 2;
const MAX_REPEAT_WORDS = 4;
const MAX_REPEATED_PHRASES = 5;
const MAX_LOW_CONFIDENCE_GAP_SECONDS = 0.75;
const DEFAULT_LONG_PAUSE_SECONDS = 3;
const DEFAULT_LOW_CONFIDENCE = 0.7;

function normalizeToken(text) {
  return text.toLowerCase().replace(/[^a-z']/g, "");
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function calculateSpeakingSeconds(words) {
  return round(words.reduce((total, word) => total + word.endSeconds - word.startSeconds, 0));
}

function findFillers(words, configuredFillers) {
  const tokens = words.map((word) => normalizeToken(word.text));
  const phrases = [...configuredFillers].sort((left, right) => right.split(" ").length - left.split(" ").length);
  const matches = [];
  const consumed = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const phrase = phrases.find((candidate) => matchesAt(tokens, candidate, { index, consumed }));
    if (!phrase) continue;
    const length = phrase.split(" ").length;
    for (let offset = 0; offset < length; offset += 1) consumed.add(index + offset);
    matches.push({ phrase, atSeconds: words[index].startSeconds });
  }
  return matches;
}

function matchesAt(tokens, phrase, { index, consumed }) {
  const parts = phrase.split(" ");
  if (parts.some((_part, offset) => consumed.has(index + offset))) return false;
  return parts.every((part, offset) => tokens[index + offset] === part);
}

function findLongPauses(words, thresholdSeconds) {
  const pauses = [];
  for (let index = 1; index < words.length; index += 1) {
    const durationSeconds = words[index].startSeconds - words[index - 1].endSeconds;
    if (durationSeconds > thresholdSeconds) {
      pauses.push({
        startSeconds: words[index - 1].endSeconds,
        endSeconds: words[index].startSeconds,
        durationSeconds: round(durationSeconds),
      });
    }
  }
  return pauses;
}

function findRepeatedPhrases(words) {
  const tokens = words.map((word) => normalizeToken(word.text)).filter(Boolean);
  const candidates = [];
  for (let size = MAX_REPEAT_WORDS; size >= MIN_REPEAT_WORDS; size -= 1) {
    const occurrences = collectNgrams(tokens, size);
    for (const [phrase, indexes] of occurrences) {
      if (indexes.length >= 2 && !candidates.some((item) => item.phrase.includes(phrase))) {
        candidates.push({ phrase, count: indexes.length, wordIndexes: indexes });
      }
    }
  }
  return candidates.slice(0, MAX_REPEATED_PHRASES);
}

function collectNgrams(tokens, size) {
  const occurrences = new Map();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    const phrase = tokens.slice(index, index + size).join(" ");
    const indexes = occurrences.get(phrase) ?? [];
    indexes.push(index);
    occurrences.set(phrase, indexes);
  }
  return occurrences;
}

function calculateSentenceLengths(words) {
  const lengths = [];
  let currentLength = 0;
  for (const word of words) {
    currentLength += 1;
    if (/[.!?]["']?$/.test(word.text)) {
      lengths.push(currentLength);
      currentLength = 0;
    }
  }
  if (currentLength > 0) lengths.push(currentLength);
  const averageWords = lengths.length ? round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length) : 0;
  return { count: lengths.length, averageWords, maximumWords: Math.max(0, ...lengths), values: lengths };
}

function findLowConfidenceSegments(words, threshold) {
  const segments = [];
  let active = [];
  const flush = () => {
    if (!active.length) return;
    segments.push(createConfidenceSegment(active));
    active = [];
  };
  for (const word of words) {
    const continues = active.length && word.startSeconds - active.at(-1).endSeconds <= MAX_LOW_CONFIDENCE_GAP_SECONDS;
    if (word.confidence < threshold && (!active.length || continues)) active.push(word);
    else if (word.confidence < threshold) {
      flush();
      active.push(word);
    } else flush();
  }
  flush();
  return segments;
}

function createConfidenceSegment(words) {
  const confidence = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
  return {
    startSeconds: words[0].startSeconds,
    endSeconds: words.at(-1).endSeconds,
    confidence: round(confidence),
    wordCount: words.length,
  };
}

export function calculateMetrics(transcript, options = {}) {
  const words = transcript.words;
  const speakingSeconds = calculateSpeakingSeconds(words);
  const fillers = findFillers(words, options.fillers ?? DEFAULT_FILLERS);
  const minutes = speakingSeconds / 60;
  return {
    totalDurationSeconds: round(transcript.durationSeconds),
    effectiveSpeakingSeconds: speakingSeconds,
    wordCount: words.length,
    wordsPerMinute: minutes > 0 ? round(words.length / minutes, 1) : 0,
    fillers: {
      total: fillers.length,
      perMinute: minutes > 0 ? round(fillers.length / minutes, 1) : 0,
      occurrences: fillers,
    },
    longPauses: findLongPauses(words, options.longPauseSeconds ?? DEFAULT_LONG_PAUSE_SECONDS),
    repeatedPhrases: findRepeatedPhrases(words),
    sentenceLengths: calculateSentenceLengths(words),
    lowConfidenceSegments: findLowConfidenceSegments(words, options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE),
  };
}

// OpenAI verbose_json 最小夹具：包含逐词时间戳与 segment avg_logprob。
export const openAiTranscriptionFixture = {
  language: "english",
  duration: 2.5,
  words: [
    { word: "Hello", start: 0, end: 0.5 },
    { word: "world.", start: 0.6, end: 1.1 },
  ],
  segments: [{ start: 0, end: 1.2, avg_logprob: -0.1 }],
};

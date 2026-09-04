/**
 * @typedef {Object} TranscriptWord
 * @property {string} text 单词原文，可保留用于句子切分的结尾标点。
 * @property {number} startSeconds 单词开始时间，必须为非负秒数。
 * @property {number} endSeconds 单词结束时间，必须不小于开始时间。
 * @property {number} confidence 供应商置信度，范围为 0 到 1。
 */

/**
 * @typedef {Object} Transcript
 * @property {string} language BCP-47 或简化语言标签，MVP 仅接受英语。
 * @property {number} durationSeconds 音频总时长。
 * @property {TranscriptWord[]} words 按时间升序排列的逐词结果。
 * @property {string} provider 供应商稳定标识，不得包含凭证。
 * @property {number} estimatedCostUsd 本次转写的估算美元成本。
 * @property {number} processingDurationMs 供应商报告或适配层测得的处理时长。
 */

/**
 * @typedef {Object} SttProvider
 * @property {string} name 稳定供应商名称。
 * @property {(input: unknown, context: {signal: AbortSignal}) => Promise<Transcript>} transcribe
 */

/**
 * @typedef {Object} FeedbackItem
 * @property {"high"|"medium"|"low"} priority
 * @property {string} issue
 * @property {string} evidence
 * @property {string} revision
 * @property {string} rerecordPrompt
 */

export {};

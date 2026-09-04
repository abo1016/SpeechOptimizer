# Speech Engine Contract

## 范围

`@speechoptimizer/speech-engine` 提供 SpeechOptimizer MVP 的服务端语音分析边界。当前实现只使用固定夹具，不发送真实音频，不读取密钥，也不产生付费调用。

公共入口为 `src/index.js`。调用方不得依赖未导出的内部文件。

## 统一分析接口

```js
const result = await analyzeSpeech(audioInput, {
  sttProvider,
  feedbackProvider,
  sttTimeoutMs: 30_000,
  feedbackTimeoutMs: 10_000,
  metrics: {
    longPauseSeconds: 3,
    lowConfidenceThreshold: 0.7,
    fillers: ["um", "uh", "you know"],
  },
  logger,
});
```

配置说明：

- `sttProvider`：必填服务端 provider；必须提供稳定 `name` 和异步 `transcribe`。
- `feedbackProvider`：可选结构化反馈 provider；缺失、超时、输出非法或内容不安全时自动使用确定性反馈。
- `sttTimeoutMs`：转写超时毫秒数，默认 `30000`；超时抛出可重试的 `STT_TIMEOUT`。
- `feedbackTimeoutMs`：反馈超时毫秒数，默认 `10000`；超时不终止分析，而是记录降级原因。
- `metrics.longPauseSeconds`：长停顿严格大于阈值才计数，默认 `3` 秒。
- `metrics.lowConfidenceThreshold`：低于此置信度的相邻词合并为片段，默认 `0.7`。
- `metrics.fillers`：覆盖默认英语口头禅集合；匹配优先采用最长短语并避免重叠计数。
- `logger`：可注入 `info/warn/error`；日志只记录阶段、provider、词数、耗时和错误码，不记录音频或完整转写。

输出包含：

- `transcript`：英语语言标识、音频时长、逐词时间戳、逐词置信度和 provider 使用量。
- `metrics`：总时长、有效说话时长、WPM、口头禅、长停顿、重复短语、句长和低置信片段。
- `feedback`：最多三条建议；每条包含 `issue/evidence/revision/rerecordPrompt`。
- `feedbackMetadata`：反馈来源和可选降级原因。
- `usage`：总估算成本、按当前费率外推的两分钟估算成本、端到端处理时长，以及转写和反馈分阶段字段。两分钟字段只用于成本预算，不代表供应商报价承诺。

## STT Provider

```js
const provider = {
  name: "stable-provider-name",
  async transcribe(audioInput, { signal }) {
    return {
      language: "en-US",
      durationSeconds: 60,
      words: [
        { text: "Hello.", startSeconds: 0.2, endSeconds: 0.7, confidence: 0.98 },
      ],
      provider: "stable-provider-name",
      estimatedCostUsd: 0.01,
      processingDurationMs: 900,
    };
  },
};
```

真实供应商必须由业务服务通过 `createServerSttAdapter` 注入 `request` 函数。凭证只能由该服务端函数从环境读取；引擎不接受、持久化或记录 API key。

逐词数组必须按时间升序排列，时间单位统一为秒，置信度范围为 `0..1`。MVP 仅接受 `en` 开头的语言标签。

## Feedback Provider

```js
const provider = {
  name: "structured-feedback-v1",
  async generate({ transcript, metrics }, { signal }) {
    return {
      items: [{
        priority: "high",
        issue: "Observable delivery issue.",
        evidence: "Metric or timestamp evidence.",
        revision: "Concrete editing instruction.",
        rerecordPrompt: "Specific next-take prompt.",
      }],
      estimatedCostUsd: 0.002,
      processingDurationMs: 120,
    };
  },
};
```

输出必须是最多三条的数组。`transcript` 允许服务端 provider 分析开场、结构、冗余和重复表达，但调用方仍须遵守用户授权与数据传输政策。引擎拒绝心理、人格和医疗判断；不安全结果不会返回给业务层。结构错误、供应商错误、超时和不安全内容统一降级到本地确定性反馈。

## Take Comparison

`compareTakes(beforeAnalysis, afterAnalysis)` 返回：

- `improved`：至少两项归一化指标改善，且没有测得回退。
- `no_meaningful_change`：变化太小，或改善与回退混合。
- `not_comparable`：词数过少、总时长比例超出 `0.65..1.5`，或词数比例超出 `0.6..1.5`。

比较使用 WPM 到目标区间的距离，以及每分钟口头禅、长停顿和重复短语；不会因为第二次录音更短直接判为改善。`feedbackChanges` 另外列出按问题文本匹配的 `resolved/persisting/introduced` 建议，供报告解释使用。

## 错误与隐私

稳定错误码包括 `INVALID_STT_PROVIDER`、`INVALID_FEEDBACK_PROVIDER`、`UNSUPPORTED_LANGUAGE`、`INVALID_TRANSCRIPT`、`STT_TIMEOUT` 和 `STT_FAILED`。只有明确的临时转写故障标记为 `retryable`；反馈配置或调用异常会记录降级原因并返回确定性结果。

分析结果当前包含逐词转写，持久化、删除和访问控制由业务服务负责。日志不得附加 `audioInput`、词文本、完整 transcript、provider 原始响应或密钥。

## 本地门禁

配置项说明：`check` 递归做 Node 语法检查；`test` 只运行 `*.test.js`，避免把 fixture 误计为测试；`build` 清理并生成仅含运行时源码的 `dist`。三个脚本均不联网、不安装依赖。

```bash
npm run check
npm test
npm run build
```

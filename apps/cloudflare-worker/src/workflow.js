import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { validateTrustedDuration } from "./config.js";
import { D1Repository } from "./repository.js";
import { requestOpenAiTranscription } from "./provider.js";
import { buildReport } from "./report.js";
import { audioStorage } from "./storage/index.js";
import { completeAnalysis } from "./workflow-completion.js";
import { decodeWorkflowError, encodeWorkflowError } from "./workflow-error.js";

const TRANSCRIBE_STEP_OPTIONS = {
  // 单个外部调用由 AbortSignal 在 90 秒后终止；Workflow 最多再执行两次并使用指数退避。
  retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
  timeout: "2 minutes",
};

// Queue 消费器不依赖 Workers Workflow runtime，独立导出后可由 Node 定向测试验证 DLQ 状态语义。
export { consumeAnalysisQueue } from "./queue-consumer.js";

/** Workflow 把外部网络调用拆成可重试步骤，状态写入始终由 D1 条件更新保护。 */
export class SpeechAnalysisWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { analysisId, attempt } = event.payload;
    const repository = new D1Repository(this.env.DB);
    const started = await step.do("claim-analysis", () => claim(repository, analysisId, attempt));
    if (!started) return { ignored: true, analysisId, attempt };
    try {
      const transcription = await step.do("transcribe", TRANSCRIBE_STEP_OPTIONS, async () => {
        try {
          return await transcribe(this.env, analysisId);
        } catch (error) {
          const message = encodeWorkflowError(error);
          // Provider 4xx、配置错误与对象完整性错误不能靠重试恢复；直接终止当前 step 的重试循环。
          if (error?.retryable === false) throw new NonRetryableError(message);
          throw new Error(message);
        }
      });
      await step.do("validate-duration", () => validateTrustedDuration(this.env, transcription, started.owner.type));
      await step.do("mark-analyzing", () => repository.transition(analysisId, ["transcribing"], "analyzing", {}, "analysis.analyzing"));
      const result = await step.do("build-report", () => buildReport(transcription));
      return await step.do("persist-result", () => completeAnalysis(this.env, repository, analysisId, result));
    } catch (error) {
      const normalized = decodeWorkflowError(error) ?? error;
      await step.do("persist-failure", () => failAnalysis(repository, analysisId, normalized));
      throw error;
    }
  }
}

async function claim(repository, analysisId, attempt) {
  const current = await repository.getAnalysis(analysisId);
  if (!current || current.status !== "uploaded" || current.attempt + 1 !== attempt) return false;
  return repository.transition(analysisId, ["uploaded"], "transcribing", {
    attempt, error_code: null, error_retryable: null, failure_stage: null, failed_at: null,
  },
    "analysis.transcribing");
}

async function transcribe(env, analysisId) {
  const repository = new D1Repository(env.DB);
  const analysis = await repository.getAnalysis(analysisId);
  if (!analysis?.audio?.objectKey) throw new Error("audio object missing");
  // 本地集成测试不调用外部付费 Provider，只验证 Queue/Workflow/D1/Storage/报告状态链。
  if (env.APP_ENV === "local") {
    return { text: "hello um world", duration: 4,
      words: [{ word: "hello", start: 0, end: 0.5 }, { word: "um", start: 1, end: 1.2 },
        { word: "world", start: 3.4, end: 4 }] };
  }
  // Preview/Production 从 Supabase 直连 OpenAI：对象流会在 multipart 写出时逐 chunk 验证长度，绝不缓冲完整音频。
  // 注意：audio-complete 的 metadata checksum 不是服务端重算；流式 SHA-256 的 CPU/完整性实测仍是 Phase 0 上线 Gate。
  const storage = audioStorage(env);
  if (!("getObjectStream" in storage)) {
    throw Object.assign(new Error("生产 STT 仅支持流式对象存储读取"), { code: "STT_STREAMING_UNAVAILABLE", retryable: false });
  }
  const audio = await storage.getObjectStream(analysis.audio.objectKey, analysis.audio.size);
  if (!audio) throw new Error("audio object missing");
  return requestOpenAiTranscription(env, analysis, audio);
}

async function failAnalysis(repository, analysisId, error) {
  const current = await repository.getAnalysis(analysisId);
  if (!current || current.status === "cancelled" || current.status === "failed") return current;
  const retryable = error?.retryable !== false;
  return repository.transition(analysisId, [current.status], "failed", {
    error_code: error?.code ?? "PROCESSING_FAILED", error_retryable: retryable ? 1 : 0,
    failure_stage: "workflow", failed_at: new Date().toISOString(),
  }, "analysis.failed");
}

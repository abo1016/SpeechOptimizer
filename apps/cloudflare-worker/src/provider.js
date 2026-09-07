import { openAiSttConfig, requiredSecret } from "./config.js";
import { logEvent } from "./logger.js";

const STT_REQUEST_TIMEOUT_MS = 90 * 1000;
const encoder = new TextEncoder();

/**
 * 调用 OpenAI-compatible STT 时使用固定分析 ID 作为幂等键，并由调用方所在 Workflow 最多重放两次。
 * audio 必须是对象存储返回的原始字节流，禁止传入 ArrayBuffer、Blob 或 File，避免完整音频驻留 Worker 内存。
 */
export async function requestOpenAiTranscription(env, analysis, audio, fetchImpl = fetch, timeoutMs = STT_REQUEST_TIMEOUT_MS) {
  const providerConfig = resolveProviderConfig(env);
  const multipart = createTranscriptionMultipart(analysis, audio, providerConfig.model);
  const signal = AbortSignal.timeout(timeoutMs);
  const cancelStream = () => { void multipart.cancel(signal.reason); };
  signal.addEventListener("abort", cancelStream, { once: true });
  if (!multipart.fixedLength) logEvent("warn", "provider.stt_fixed_length_fallback", {
    provider: "openai", operation: "transcription", contentLength: multipart.contentLength,
  });
  try {
    const response = await fetchImpl(providerConfig.url, {
      method: "POST", headers: transcriptionHeaders(providerConfig.apiKey, analysis.id, multipart), body: multipart.body, signal,
    });
    if (!response.ok) {
      await multipart.cancel(`OpenAI returned ${response.status}`);
      const retryable = response.status === 429 || response.status >= 500;
      const error = providerError(retryable ? "STT_UNAVAILABLE" : "STT_REQUEST_REJECTED",
        "STT 服务拒绝处理音频", retryable, response.status === 401 || response.status === 403 ? 502 : 422,
        response.status);
      logProviderFailure(error, response.status);
      throw error;
    }
    await multipart.done;
    try {
      return await response.json();
    } catch {
      const error = providerError("STT_RESPONSE_INVALID", "STT 服务返回无效结果", true, 502, response.status);
      logProviderFailure(error, response.status);
      throw error;
    }
  } catch (cause) {
    await multipart.cancel(cause);
    if (isNormalizedProviderError(cause)) throw cause;
    const error = requestFailure(signal, multipart.failure ?? cause);
    logProviderFailure(error);
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelStream);
  }
}

/** 为 multipart 每段精确计算字节长度；文件字节直接透传，不会拼接成新数组。 */
function createTranscriptionMultipart(analysis, audio, model) {
  const declaration = audioDeclaration(analysis, audio);
  const boundary = `speechoptimizer-${crypto.randomUUID().replaceAll("-", "")}`;
  const prefix = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.webm"\r\nContent-Type: ${declaration.mime}\r\n\r\n`);
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const contentLength = prefix.byteLength + declaration.size + suffix.byteLength;
  const raw = createAudioMultipartStream(audio.stream, declaration.size, prefix, suffix);
  return addFixedLengthControl(raw, boundary, contentLength);
}

/** 流结束时核对实际字节数；这能拒绝截断和超长响应，同时保持 Chunk 级内存占用。 */
function createAudioMultipartStream(source, expectedSize, prefix, suffix) {
  const reader = source.getReader();
  let stage = "prefix";
  let bytesRead = 0;
  let failed;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const body = new ReadableStream({
    async pull(controller) {
      try {
        if (stage === "prefix") { controller.enqueue(prefix); stage = "audio"; return; }
        if (stage === "audio") {
          const chunk = await reader.read();
          if (!chunk.done) {
            if (!(chunk.value instanceof Uint8Array)) throw streamError("AUDIO_STREAM_INVALID", "对象存储返回了无效音频流", 502);
            bytesRead += chunk.value.byteLength;
            if (bytesRead > expectedSize) throw streamError("AUDIO_SIZE_MISMATCH", "音频流长度超过已确认对象", 409);
            controller.enqueue(chunk.value);
            return;
          }
          if (bytesRead !== expectedSize) throw streamError("AUDIO_SIZE_MISMATCH", "音频流长度与已确认对象不一致", 409);
          controller.enqueue(suffix); stage = "close"; return;
        }
        controller.close();
        resolveDone();
      } catch (error) {
        failed = error;
        controller.error(error);
        rejectDone(error);
        await reader.cancel(error);
      }
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
  // Fetch 可能在非 2xx 或超时后停止读取；提前处理 rejected Promise，避免产生未处理拒绝。
  void done.catch(() => {});
  return { body, done, get failure() { return failed; }, async cancel(reason) { await reader.cancel(reason); } };
}

/** Cloudflare 原生 FixedLengthStream 会自动生成 Content-Length；本地 Node 测试使用显式长度头兜底。 */
function addFixedLengthControl(raw, boundary, contentLength) {
  const Stream = fixedLengthStreamConstructor();
  if (!Stream) return { ...raw, boundary, contentLength, fixedLength: false };
  const fixed = new Stream(contentLength);
  const aborter = new AbortController();
  const piping = raw.body.pipeTo(fixed.writable, { signal: aborter.signal });
  const done = Promise.all([raw.done, piping]).then(() => undefined);
  // pipeTo 由 fetch 消费驱动；失败会通过 body 或 done 传回，提前吸收以防提前取消时产生未处理拒绝。
  void done.catch(() => {});
  return { body: fixed.readable, boundary, contentLength, fixedLength: true, done,
    get failure() { return raw.failure; }, async cancel(reason) { aborter.abort(reason); await raw.cancel(reason); } };
}

/** 取用运行时的 Cloudflare 专有构造器，避免本地 Node 单元测试伪造全局类型。 */
function fixedLengthStreamConstructor() {
  const globals = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
  const candidate = globals.FixedLengthStream;
  return typeof candidate === "function" ? /** @type {new (length: number) => { readable: ReadableStream, writable: WritableStream }} */ (candidate) : null;
}

/** 已确认对象声明是 multipart 长度边界；checksum 仍由 audio-complete 元数据保存，流式重算是单独上线 Gate。 */
function audioDeclaration(analysis, audio) {
  const size = Number(analysis?.audio?.size);
  const streamSize = Number(audio?.size);
  const mime = String(analysis?.audio?.mime ?? "").toLowerCase();
  if (!Number.isSafeInteger(size) || size <= 0) throw streamError("AUDIO_SIZE_MISMATCH", "音频对象长度无效", 409);
  if (!Number.isSafeInteger(streamSize) || streamSize !== size) throw streamError("AUDIO_SIZE_MISMATCH", "对象流长度与已确认对象不一致", 409);
  if (mime !== "audio/webm" && mime !== "audio/webm;codecs=opus") throw streamError("AUDIO_MIME_MISMATCH", "音频对象类型无效", 415);
  if (!audio?.stream || typeof audio.stream.getReader !== "function") throw streamError("AUDIO_STREAM_INVALID", "未取得音频对象流", 502);
  return { size, mime };
}

/** 仅在 FixedLengthStream 不可用的受控降级路径显式设置长度；Cloudflare 原生路径由运行时生成该头。 */
function transcriptionHeaders(apiKey, analysisId, multipart) {
  const headers = { authorization: `Bearer ${apiKey}`, "idempotency-key": `speechoptimizer-stt-${analysisId}`,
    "content-type": `multipart/form-data; boundary=${multipart.boundary}` };
  if (!multipart.fixedLength) headers["content-length"] = String(multipart.contentLength);
  return headers;
}

/** 在读取或发送音频前解析 Secret、完整 endpoint 和模型；配置错误不进入 Workflow 重试。 */
function resolveProviderConfig(env) {
  try {
    const { url, model } = openAiSttConfig(env);
    const apiKey = requiredSecret(env, "OPENAI_API_KEY");
    return { apiKey, url, model };
  } catch (cause) {
    const error = providerError(cause?.code === "SERVICE_NOT_CONFIGURED" ? "STT_NOT_CONFIGURED" : "STT_CONFIG_INVALID",
      cause?.code === "SERVICE_NOT_CONFIGURED" ? "STT 服务未配置" : "STT 配置无效", false, 503);
    logProviderFailure(error);
    throw error;
  }
}

/** 将对象流验证失败保留为不可重试业务错误，网络与超时仍沿用既有稳定 Provider 映射。 */
function requestFailure(signal, cause) {
  if (cause?.code === "AUDIO_SIZE_MISMATCH" || cause?.code === "AUDIO_STREAM_INVALID" || cause?.code === "AUDIO_MIME_MISMATCH") return cause;
  return providerError(signal.aborted || cause?.name === "AbortError" || cause?.name === "TimeoutError"
    ? "STT_TIMEOUT" : "STT_NETWORK_ERROR", "STT 服务暂时不可用", true, 503);
}

/** 非 2xx 与响应解析已完成稳定映射，外层清理流资源时不得再次包装为网络错误。 */
function isNormalizedProviderError(error) {
  return error?.code === "STT_NOT_CONFIGURED" || error?.code === "STT_CONFIG_INVALID"
    || error?.code === "STT_UNAVAILABLE" || error?.code === "STT_REQUEST_REJECTED" || error?.code === "STT_RESPONSE_INVALID";
}

function streamError(code, message, status) { return Object.assign(new Error(message), { code, retryable: false, status }); }

/** 将底层异常转换为 D1 与前端均可依赖的稳定错误码，同时保留 Workflow 重试判断。 */
function providerError(code, message, retryable, status, providerStatus = /** @type {number | null} */ (null)) {
  return Object.assign(new Error(message), { code, retryable, status, providerStatus });
}

/** Provider 错误只保留安全运维字段；错误 message 和 response body 都可能包含外部敏感信息。 */
function logProviderFailure(error, providerStatus) {
  logEvent("warn", "provider.stt_request_failed", {
    provider: "openai", operation: "transcription", providerStatus: providerStatus ?? null,
    errorCode: error.code, retryable: error.retryable,
  });
}

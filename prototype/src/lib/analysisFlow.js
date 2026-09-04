export const TERMINAL_ANALYSIS_STATUSES = new Set(["completed", "failed", "cancelled"]);

/** 轮询只在任务未结束时等待；AbortSignal 让离页和取消立即停止网络活动。 */
export async function pollAnalysis(id, options) {
  const read = options.read;
  const wait = options.wait ?? delay;
  const intervalMs = options.intervalMs ?? 1200;
  while (true) {
    assertActive(options.signal);
    const analysis = await read(id, options.signal);
    options.onUpdate?.(analysis);
    if (TERMINAL_ANALYSIS_STATUSES.has(analysis.status)) return analysis;
    await wait(intervalMs, options.signal);
  }
}

export function analysisStep(status) {
  if (status === "created" || status === "uploaded") return 0;
  if (status === "transcribing") return 1;
  if (status === "analyzing" || status === "completed") return 2;
  return 0;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function assertActive(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

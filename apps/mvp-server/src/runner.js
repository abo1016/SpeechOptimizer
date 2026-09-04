/** 单进程异步任务 runner；相同任务只入队一次，业务状态仍由核心平台持有。 */
export class AnalysisRunner {
  constructor({ execute, logger }) {
    this.execute = execute;
    this.logger = logger;
    this.pending = new Set();
  }

  schedule(analysisId) {
    if (this.pending.has(analysisId)) return false;
    this.pending.add(analysisId);
    setImmediate(() => this.#run(analysisId));
    this.logger.info("runner.scheduled", { analysisId });
    return true;
  }

  async #run(analysisId) {
    try {
      await this.execute(analysisId);
      this.logger.info("runner.completed", { analysisId });
    } catch (error) {
      this.logger.error("runner.failed", { analysisId, code: error.code ?? "PROCESSING_FAILED" });
    } finally {
      this.pending.delete(analysisId);
    }
  }
}

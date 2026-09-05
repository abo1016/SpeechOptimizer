import { routeRequest } from "./router.js";
import { consumeAnalysisQueue, SpeechAnalysisWorkflow } from "./workflow.js";
import { cleanupAudioStorage } from "./cleanup.js";

export { SpeechAnalysisWorkflow };

export default {
  /** HTTP 请求只走 Fetch Router，不在入口层读写数据库。 */
  async fetch(request, env) {
    return routeRequest(request, env);
  },

  /** Queue handler 只负责幂等派发 Workflow，真正处理步骤由 Workflow 承担。 */
  async queue(batch, env) {
    return consumeAnalysisQueue(batch, env);
  },

  /** 每日定时清理兜底处理生命周期延迟、失败任务和 D1 删除后的孤儿对象。 */
  async scheduled(_controller, env) {
    await cleanupAudioStorage(env);
  },
};

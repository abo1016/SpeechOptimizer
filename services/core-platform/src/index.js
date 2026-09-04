import { AnalysisRepository } from "./analysis-repository.js";
import { createConfig } from "./config.js";
import { CorePlatformService } from "./core-platform-service.js";
import { JsonDatabase } from "./json-database.js";
import { LocalObjectStore } from "./local-object-store.js";
import { createSafeLogger } from "./logger.js";
import { ServerMediaInspector } from "./media-inspector.js";

export { CoreError } from "./errors.js";
export { createHttpServer } from "./http-server.js";
export { ServerMediaInspector, detectMime } from "./media-inspector.js";
export { ANALYSIS_STATUSES, assertTransition } from "./state-machine.js";

/** 使用本地默认适配器组装可嵌入核心平台；外部语音能力必须显式注入。 */
export function createCorePlatform(options = {}) {
  if (!options.speechProcessor) throw new TypeError("必须注入 speechProcessor");
  const config = createConfig(options.config);
  const logger = options.logger ?? createSafeLogger();
  const database = options.database ?? new JsonDatabase(config.databaseFile);
  const repository = options.repository ?? new AnalysisRepository({ database, clock: options.clock });
  const objectStore = options.objectStore ?? new LocalObjectStore(config.objectDirectory);
  const mediaInspector = options.mediaInspector ?? new ServerMediaInspector({
    durationResolver: options.durationResolver,
  });
  return new CorePlatformService({
    repository, objectStore, mediaInspector, speechProcessor: options.speechProcessor, config, logger,
  });
}

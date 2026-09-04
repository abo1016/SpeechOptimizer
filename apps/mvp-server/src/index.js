import { MvpApplication } from "./application.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { PersistentStore } from "./persistent-store.js";
import { createProviders } from "./providers.js";
import { createMvpServer } from "./server.js";

export async function createRuntime(options = {}) {
  const config = options.config ?? loadConfig(process.env, options.configOverrides);
  const logger = options.logger ?? createLogger();
  const store = options.store ?? await new PersistentStore(config.appStateFile).load();
  const providers = options.providers ?? createProviders(config, logger, options.fetchImpl, options.externalProviders);
  const application = new MvpApplication({ config, store, providers, logger });
  // 恢复必须发生在 HTTP 服务对外提供请求前，确保快照和核心 JSON 数据库先达到一致。
  await application.recoverPendingAnalyses();
  const server = createMvpServer({ application, config, logger });
  return { config, logger, store, providers, application, server };
}

async function main() {
  const runtime = await createRuntime();
  runtime.server.listen(runtime.config.port, runtime.config.host, () => {
    runtime.logger.info("server.started", { host: runtime.config.host,
      port: runtime.config.port, providerMode: runtime.providers.mode });
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    console.error(`[mvp-server] 启动失败 code=${error.code ?? "STARTUP_FAILED"} message=${error.message}`);
    process.exitCode = 1;
  });
}

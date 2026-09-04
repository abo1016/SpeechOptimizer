import { resolve } from "node:path";

/**
 * 核心服务配置。所有路径默认位于当前包的 .local 目录，避免污染仓库其他模块。
 * 调用方可以逐项覆盖；生产接入时应将目录切换到受控持久卷。
 */
export function createConfig(overrides = {}) {
  const rootDirectory = resolve(overrides.rootDirectory ?? ".local");
  return Object.freeze({
    // databaseFile：业务记录、幂等键和审计事件的原子 JSON 持久化文件。
    databaseFile: overrides.databaseFile
      ? resolve(overrides.databaseFile)
      : resolve(rootDirectory, "database.json"),
    // objectDirectory：原始音频对象目录；账户或任务删除会同步清理这里的对象。
    objectDirectory: overrides.objectDirectory
      ? resolve(overrides.objectDirectory)
      : resolve(rootDirectory, "objects"),
    // maxAudioBytes：服务端接受的音频上限，默认 25 MiB，不能依赖客户端校验。
    maxAudioBytes: overrides.maxAudioBytes ?? 25 * 1024 * 1024,
    // minDurationMs/maxDurationMs：MVP 音频时长边界，默认 30 至 120 秒。
    minDurationMs: overrides.minDurationMs ?? 30_000,
    maxDurationMs: overrides.maxDurationMs ?? 120_000,
  });
}

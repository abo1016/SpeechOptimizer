import { createFfprobeMediaAdapter } from "../../../packages/provider-adapters/src/index.js";

/** 复用 provider-adapters 的安全 ffprobe 实现，不接受客户端声明的时长。 */
export function createDurationResolver(ffprobePath, logger, mode) {
  return createFfprobeMediaAdapter({ command: ffprobePath, logger, mode }).durationResolver;
}

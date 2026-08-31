/**
 * 原型阶段统一记录交互事件，后续接入埋点时只需替换这一处实现。
 * 日志只包含界面动作和 Mock 标识，不记录音频、转写或用户输入内容。
 */
export function logEvent(event, detail = {}) {
  console.info(`[SpeechOptimizer] ${event}`, {
    at: new Date().toISOString(),
    ...detail,
  });
}

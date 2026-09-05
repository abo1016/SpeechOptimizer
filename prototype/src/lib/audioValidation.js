/**
 * 原型上传约束集中在纯函数中，便于未来替换为服务端校验并保持前后端一致。
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_AUDIO_TYPES = ["audio/webm", "audio/webm;codecs=opus"];
export const ANONYMOUS_MAX_RECORDING_SECONDS = 60;
export const ACCOUNT_MAX_RECORDING_SECONDS = 5 * 60;

export function validateAudioFile(file) {
  if (!file) return { valid: false, reason: "missing_file", message: "Choose an audio file to continue." };
  const validType = ACCEPTED_AUDIO_TYPES.includes(file.type) || (/\.webm$/i.test(file.name || "") && !file.type);
  if (!validType) return { valid: false, reason: "unsupported_type", message: "Only WebM/Opus audio is supported for this beta." };
  if (file.size > MAX_FILE_BYTES) return { valid: false, reason: "file_too_large", message: "This file is larger than 10 MiB. Choose a smaller WebM/Opus file." };
  return { valid: true };
}

/** 匿名体验按免费试用时长预检；登录账户才展示完整的五分钟录音能力。 */
export function recordingLimitSeconds(user) {
  return user ? ACCOUNT_MAX_RECORDING_SECONDS : ANONYMOUS_MAX_RECORDING_SECONDS;
}

// 录音按钮只负责开始、暂停和继续；已有 take 必须通过显式重录操作替换。
export function nextRecordingStatus(status) {
  if (status === "recording") return "paused";
  if (status === "paused" || status === "ready") return "recording";
  return null;
}

/**
 * 原型上传约束集中在纯函数中，便于未来替换为服务端校验并保持前后端一致。
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/webm"];

export function validateAudioFile(file) {
  if (!file) return { valid: false, reason: "missing_file", message: "Choose an audio file to continue." };
  const validType = ACCEPTED_AUDIO_TYPES.includes(file.type) || /\.(mp3|wav|m4a|webm)$/i.test(file.name || "");
  if (!validType) return { valid: false, reason: "unsupported_type", message: "This file type is not supported. Choose MP3, WAV, M4A, or WebM." };
  if (file.size > MAX_FILE_BYTES) return { valid: false, reason: "file_too_large", message: "This file is larger than 25 MB. Choose a smaller audio file." };
  return { valid: true };
}

// 录音按钮只负责开始、暂停和继续；已有 take 必须通过显式重录操作替换。
export function nextRecordingStatus(status) {
  if (status === "recording") return "paused";
  if (status === "paused" || status === "ready") return "recording";
  return null;
}

import { invariant } from "../errors.js";

/** 音频对象 key 由服务端生成，owner 与 analysisId 都进入路径，避免客户端选择任意对象。 */
export function audioObjectKey(owner, analysisId) {
  const safeOwner = `${owner.type}-${owner.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `audio/${safeOwner}/${analysisId}/${crypto.randomUUID()}.webm`;
}

/** 所有存储 Provider 共用同一份上传声明校验，避免迁移后出现行为分叉。 */
export function assertAudioDeclaration(input, config) {
  const mime = String(input.mime ?? input.type ?? "").toLowerCase();
  invariant(mime === "audio/webm" || mime === "audio/webm;codecs=opus",
    "UNSUPPORTED_MEDIA_TYPE", "首版仅支持 WebM/Opus 音频", 415);
  const size = Number(input.size ?? 0);
  invariant(Number.isInteger(size) && size > 0, "INVALID_AUDIO_SIZE", "音频大小无效", 400);
  invariant(size <= config.maxAudioBytes, "AUDIO_TOO_LARGE", "音频文件过大", 413);
  const sha256 = String(input.sha256 ?? "").toLowerCase();
  invariant(/^[a-f0-9]{64}$/.test(sha256), "INVALID_AUDIO_CHECKSUM", "音频 SHA-256 无效", 400);
  return { mime, size, sha256 };
}

/** 对象归属必须和当前 owner/analysis 一致；Provider 只接收已经通过此检查的 key。 */
export function assertOwnedKey(key, owner, analysisId) {
  const safeOwner = `${owner.type}-${owner.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  invariant(key.startsWith(`audio/${safeOwner}/${analysisId}/`) && !key.includes(".."),
    "AUDIO_KEY_MISMATCH", "上传对象不属于当前任务", 403);
}

/** HTTP 路径只读取前四个字节识别 WebM EBML 头，不缓冲整段音频。 */
export function assertWebmMagic(bytes) {
  invariant(bytes.length === 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3,
    "AUDIO_MAGIC_MISMATCH", "音频文件内容不是受支持的 WebM", 415);
}

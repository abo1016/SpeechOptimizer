import { fail } from "./errors.js";

const MIME_BY_EXTENSION = Object.freeze({
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/webm": "webm",
});

/**
 * 从文件内容探测 MIME，绝不信任上传请求的 Content-Type。
 * WAV 时长使用头部采样信息精确计算；其他容器通过注入 durationResolver 获取媒体时长。
 */
export class ServerMediaInspector {
  constructor({ durationResolver } = {}) {
    this.durationResolver = durationResolver;
  }

  async inspect(bytes) {
    const mime = detectMime(bytes);
    if (!mime) fail("无法识别或不支持的音频格式", "UNSUPPORTED_AUDIO_TYPE", 415);
    const durationMs = mime === "audio/wav"
      ? readWavDuration(bytes)
      : await this.#resolveDuration(bytes, mime);
    return { mime, extension: MIME_BY_EXTENSION[mime], durationMs };
  }

  async #resolveDuration(bytes, mime) {
    if (!this.durationResolver) {
      fail("该容器需要配置媒体时长解析器", "MEDIA_DURATION_UNAVAILABLE", 422);
    }
    const durationMs = await this.durationResolver({ bytes, mime });
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      fail("媒体时长解析结果无效", "INVALID_MEDIA_DURATION", 422);
    }
    return Math.round(durationMs);
  }
}

export function detectMime(bytes) {
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WAVE")) return "audio/wav";
  if (hasAscii(bytes, 0, "ID3") || isMp3Frame(bytes)) return "audio/mpeg";
  if (hasAscii(bytes, 4, "ftyp")) return "audio/mp4";
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return "audio/webm";
  }
  return null;
}

function readWavDuration(bytes) {
  if (bytes.length < 44) fail("WAV 文件头不完整", "INVALID_AUDIO_FILE", 422);
  let offset = 12;
  let byteRate;
  let dataSize;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && chunkSize >= 16) byteRate = bytes.readUInt32LE(offset + 16);
    if (chunkId === "data") dataSize = Math.min(chunkSize, bytes.length - offset - 8);
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!byteRate || dataSize === undefined) fail("WAV 缺少有效音频块", "INVALID_AUDIO_FILE", 422);
  return Math.round((dataSize / byteRate) * 1000);
}

function hasAscii(bytes, offset, value) {
  return bytes.length >= offset + value.length
    && bytes.toString("ascii", offset, offset + value.length) === value;
}

function isMp3Frame(bytes) {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

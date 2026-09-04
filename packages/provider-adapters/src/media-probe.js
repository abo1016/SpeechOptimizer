import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ProviderError } from "./errors.js";

const execFileAsync = promisify(execFile);
const EXTENSION_BY_MIME = Object.freeze({
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/webm": "webm",
});

/**
 * 创建 ffprobe 媒体探测器。文件内容决定 MIME，上传 Content-Type 不参与判断。
 */
export function createFfprobeMediaAdapter(options = {}) {
  const config = Object.freeze({
    // command：ffprobe 可执行文件名或受控绝对路径。
    command: options.command ?? "ffprobe",
    // mode：生产模式禁止任何降级探测，开发/测试模式才允许受控 fallback。
    mode: options.mode ?? process.env.NODE_ENV ?? "development",
    // fallbackCommand：macOS 默认使用系统自带 afinfo，测试可注入等价探测器。
    fallbackCommand: options.fallbackCommand ?? "afinfo",
    // platform：注入平台便于回归测试，真实运行时使用 Node 平台标识。
    platform: options.platform ?? process.platform,
    // runCommand：测试注入点，生产默认使用无 shell 的 execFile。
    runCommand: options.runCommand ?? runCommand,
    logger: options.logger ?? console,
  });
  return { inspect: (bytes) => inspect(bytes, config), durationResolver: (input) => resolveDuration(input, config) };
}

async function inspect(bytes, config) {
  const mime = detectAudioMime(bytes);
  if (!mime) throw new ProviderError("UNSUPPORTED_AUDIO_TYPE", "无法识别 MP3、M4A、WAV 或 WebM 音频");
  const durationMs = await resolveDuration({ bytes, mime }, config);
  return { mime, extension: EXTENSION_BY_MIME[mime], durationMs };
}

async function resolveDuration({ bytes, mime }, config) {
  assertBytes(bytes);
  const extension = EXTENSION_BY_MIME[mime];
  if (!extension) throw new ProviderError("UNSUPPORTED_AUDIO_TYPE", "媒体 MIME 不受支持");
  const directory = await mkdtemp(join(tmpdir(), "speechoptimizer-probe-"));
  const file = join(directory, `audio.${extension}`);
  try {
    await writeFile(file, bytes);
    const result = await executeProbe(file, config);
    config.logger.info?.("[media] 媒体探测完成", { mime, durationMs: result });
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executeProbe(file, config) {
  let stdout;
  try {
    ({ stdout } = await config.runCommand(config.command, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file]));
  } catch (cause) {
    const missing = cause?.code === "ENOENT";
    if (missing && config.mode !== "production" && config.platform === "darwin") {
      return executeFallbackProbe(file, config);
    }
    throw new ProviderError(missing ? "MEDIA_PROBE_UNAVAILABLE" : "MEDIA_PROBE_FAILED", missing ? "系统未安装 ffprobe" : "ffprobe 执行失败", { retryable: false, cause });
  }
  const seconds = parseDuration(stdout);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ProviderError("INVALID_MEDIA_DURATION", "ffprobe 返回无效时长");
  return Math.round(seconds * 1000);
}

async function executeFallbackProbe(file, config) {
  let stdout;
  try {
    ({ stdout } = await config.runCommand(config.fallbackCommand, [file]));
  } catch (cause) {
    const missing = cause?.code === "ENOENT";
    throw new ProviderError(
      missing ? "MEDIA_PROBE_UNAVAILABLE" : "MEDIA_PROBE_FAILED",
      missing ? "系统未安装 ffprobe 或 afinfo" : "afinfo 执行失败",
      { retryable: false, cause },
    );
  }
  const seconds = parseAfinfoDuration(stdout);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ProviderError("INVALID_MEDIA_DURATION", "afinfo 返回无效时长");
  return Math.round(seconds * 1000);
}

function runCommand(command, args) {
  return execFileAsync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
}

function parseDuration(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed.streams?.some((stream) => stream.codec_type === "audio")) {
      throw new ProviderError("MEDIA_AUDIO_STREAM_REQUIRED", "媒体容器不包含音频流");
    }
    return Number(parsed.format?.duration);
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    throw new ProviderError("MEDIA_PROBE_INVALID_OUTPUT", "ffprobe 输出不是有效 JSON", { cause });
  }
}

function parseAfinfoDuration(stdout) {
  const match = String(stdout).match(/Estimated duration:\s*([0-9]+(?:\.[0-9]+)?)\s*sec/i);
  if (!match) throw new ProviderError("MEDIA_PROBE_INVALID_OUTPUT", "afinfo 输出不是有效媒体信息");
  return Number(match[1]);
}

function assertBytes(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new ProviderError("INVALID_MEDIA_INPUT", "媒体探测需要 bytes");
  }
}

export function detectAudioMime(bytes) {
  assertBytes(bytes);
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE")) return "audio/wav";
  if (ascii(bytes, 0, "ID3") || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(bytes, 4, "ftyp")) return "audio/mp4";
  if (bytes.length >= 4 && Buffer.from(bytes).subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "audio/webm";
  return null;
}

function ascii(bytes, offset, value) {
  return bytes.length >= offset + value.length && Buffer.from(bytes).toString("ascii", offset, offset + value.length) === value;
}

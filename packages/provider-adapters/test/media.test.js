import test from "node:test";
import assert from "node:assert/strict";
import { createFfprobeMediaAdapter, detectAudioMime } from "../src/index.js";

const cases = [
  ["audio/mpeg", Buffer.from("ID3fixture")],
  ["audio/mp4", Buffer.from("0000ftypM4A ")],
  ["audio/wav", Buffer.from("RIFF0000WAVEfixture")],
  ["audio/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00])],
];

test("按文件签名识别 MVP 四种音频 MIME", () => {
  for (const [expected, bytes] of cases) assert.equal(detectAudioMime(bytes), expected);
});

test("ffprobe 输出转换为毫秒且适配 core durationResolver", async () => {
  const calls = [];
  const adapter = createFfprobeMediaAdapter({
    runCommand: async (command, args) => { calls.push({ command, args }); return { stdout: JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "31.234" } }) }; },
    logger: { info() {} },
  });
  const result = await adapter.inspect(cases[1][1]);
  assert.deepEqual(result, { mime: "audio/mp4", extension: "m4a", durationMs: 31234 });
  assert.equal(calls[0].command, "ffprobe");
  assert.equal(await adapter.durationResolver({ bytes: cases[3][1], mime: "audio/webm" }), 31234);
});

test("系统缺少 ffprobe 时返回稳定错误", async () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const adapter = createFfprobeMediaAdapter({ runCommand: async () => { throw missing; } });
  await assert.rejects(() => adapter.inspect(cases[0][1]), { code: "MEDIA_PROBE_UNAVAILABLE", retryable: false });
});

test("开发模式 macOS 缺少 ffprobe 时受控 fallback 到 afinfo", async () => {
  const calls = [];
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const adapter = createFfprobeMediaAdapter({
    mode: "development", platform: "darwin",
    runCommand: async (command) => {
      calls.push(command);
      if (command === "ffprobe") throw missing;
      return { stdout: "Estimated duration: 2.75 sec" };
    },
  });
  assert.equal(await adapter.durationResolver({ bytes: cases[0][1], mime: "audio/mpeg" }), 2750);
  assert.deepEqual(calls, ["ffprobe", "afinfo"]);
});

test("生产模式缺少 ffprobe 时不启用 afinfo fallback", async () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const calls = [];
  const adapter = createFfprobeMediaAdapter({
    mode: "production", platform: "darwin",
    runCommand: async (command) => { calls.push(command); throw missing; },
  });
  await assert.rejects(() => adapter.inspect(cases[0][1]), { code: "MEDIA_PROBE_UNAVAILABLE" });
  assert.deepEqual(calls, ["ffprobe"]);
});

test("ffprobe 确认容器没有音频流时拒绝", async () => {
  const adapter = createFfprobeMediaAdapter({
    runCommand: async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "31" } }) }),
  });
  await assert.rejects(() => adapter.inspect(cases[1][1]), { code: "MEDIA_AUDIO_STREAM_REQUIRED" });
});

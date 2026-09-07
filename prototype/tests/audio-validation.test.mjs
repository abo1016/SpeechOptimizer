import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_MAX_RECORDING_SECONDS, ANONYMOUS_MAX_RECORDING_SECONDS, MAX_FILE_BYTES,
  nextRecordingStatus, recordingLimitSeconds, validateAudioFile } from "../src/lib/audioValidation.js";

test("只接受 WebM/Opus，MIME 缺失时仅允许 webm 扩展名", () => {
  assert.deepEqual(validateAudioFile({ name: "take.WEBM", type: "", size: 1024 }), { valid: true });
  assert.deepEqual(validateAudioFile({ name: "take.webm", type: "video/webm", size: 1024 }), { valid: true });
  assert.equal(validateAudioFile({ name: "take.M4A", type: "", size: 1024 }).reason, "unsupported_type");
  assert.equal(validateAudioFile({ name: "take.txt", type: "video/webm", size: 1024 }).reason, "unsupported_type");
});

test("rejects unsupported formats with an actionable message", () => {
  const result = validateAudioFile({ name: "notes.txt", type: "text/plain", size: 1024 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "unsupported_type");
  assert.match(result.message, /WebM\/Opus/);
});

test("rejects files larger than the prototype limit", () => {
  const result = validateAudioFile({ name: "take.webm", type: "audio/webm", size: MAX_FILE_BYTES + 1 });
  assert.deepEqual(result, { valid: false, reason: "file_too_large", message: "This file is larger than 10 MiB. Choose a smaller WebM/Opus file." });
});

test("匿名和登录账户显示各自的录音时长预检", () => {
  assert.equal(recordingLimitSeconds(null), ANONYMOUS_MAX_RECORDING_SECONDS);
  assert.equal(recordingLimitSeconds({ id: "usr_1" }), ACCOUNT_MAX_RECORDING_SECONDS);
  assert.equal(ANONYMOUS_MAX_RECORDING_SECONDS, 60);
  assert.equal(ACCOUNT_MAX_RECORDING_SECONDS, 300);
});

test("does not restart a finished take from the central record button", () => {
  assert.equal(nextRecordingStatus("complete"), null);
  assert.equal(nextRecordingStatus("uploaded"), null);
  assert.equal(nextRecordingStatus("error"), null);
  assert.equal(nextRecordingStatus("ready"), "recording");
  assert.equal(nextRecordingStatus("recording"), "paused");
});

import assert from "node:assert/strict";
import test from "node:test";
import { MAX_FILE_BYTES, nextRecordingStatus, validateAudioFile } from "../src/lib/audioValidation.js";

test("accepts supported audio extensions even when browser MIME is empty", () => {
  assert.deepEqual(validateAudioFile({ name: "take.M4A", type: "", size: 1024 }), { valid: true });
});

test("rejects unsupported formats with an actionable message", () => {
  const result = validateAudioFile({ name: "notes.txt", type: "text/plain", size: 1024 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "unsupported_type");
  assert.match(result.message, /MP3/);
});

test("rejects files larger than the prototype limit", () => {
  const result = validateAudioFile({ name: "take.mp3", type: "audio/mpeg", size: MAX_FILE_BYTES + 1 });
  assert.deepEqual(result, { valid: false, reason: "file_too_large", message: "This file is larger than 25 MB. Choose a smaller audio file." });
});

test("does not restart a finished take from the central record button", () => {
  assert.equal(nextRecordingStatus("complete"), null);
  assert.equal(nextRecordingStatus("uploaded"), null);
  assert.equal(nextRecordingStatus("error"), null);
  assert.equal(nextRecordingStatus("ready"), "recording");
  assert.equal(nextRecordingStatus("recording"), "paused");
});

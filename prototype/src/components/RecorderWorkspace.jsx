import { Check, Clock3, FileAudio, Languages, Mic, Pause, RotateCcw, ShieldCheck, Square, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { resources } from "../api/resources.js";
import { validateAudioFile } from "../lib/audioValidation.js";
import { logEvent } from "../lib/logEvent.js";
import { useRecorder } from "../hooks/useRecorder.js";
import { useApp } from "../state/AppProvider.jsx";

const MAX_SECONDS = 120;

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** 录音与上传最终都会走同一份二进制上传 API，不保留演示态的本地跳转。 */
export function RecorderWorkspace({ navigate }) {
  const { bootError, booting, retainAudio, session, setCurrentAnalysis } = useApp();
  const fileRef = useRef(null);
  const recorder = useRecorder(MAX_SECONDS);
  const [file, setFile] = useState(null);
  const [inputError, setInputError] = useState("");
  const [pending, setPending] = useState(false);
  const source = file ?? recorder.blob;
  const status = file ? "uploaded" : recorder.status;
  const active = recorder.status === "recording" || recorder.status === "paused";
  const finished = Boolean(source) && !active;
  const recordingError = recorder.error || inputError;
  const privacyCopy = session?.user
    ? (retainAudio ? "Audio is retained for this account" : "Audio is deleted after processing")
    : "Anonymous audio is always deleted";

  const controlRecording = () => {
    if (pending || booting) return;
    if (recorder.status === "recording") return recorder.pause();
    if (recorder.status === "paused") return recorder.resume();
    setInputError("");
    recorder.start();
  };

  const reset = () => {
    recorder.reset();
    setFile(null);
    setInputError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUpload = (event) => {
    const nextFile = event.target.files?.[0];
    const validation = validateAudioFile(nextFile);
    if (!validation.valid) {
      setInputError(validation.message);
      logEvent("upload.rejected", { reason: validation.reason });
      return;
    }
    recorder.reset();
    setFile(nextFile);
    setInputError("");
    logEvent("upload.selected", { mime: nextFile.type || "unknown", sizeBytes: nextFile.size });
  };

  const analyze = async () => {
    if (!source || pending || booting || bootError) return;
    setPending(true);
    setInputError("");
    try {
      // 服务端创建的任务 ID 是后续上传、轮询与报告路径唯一可信来源。
      const created = await resources.createAnalysis(retainAudio);
      const analysis = created.analysis ?? created;
      if (!analysis?.id) throw new Error("The service did not return an analysis ID.");
      setCurrentAnalysis(analysis);
      const uploaded = await resources.uploadAudio(analysis.id, source);
      setCurrentAnalysis(uploaded.analysis ?? uploaded);
      logEvent("analysis.upload_completed", { analysisId: analysis.id, source: file ? "upload" : "recording" });
      navigate(`/analysis/${encodeURIComponent(analysis.id)}/processing`);
    } catch (error) {
      setInputError(error.message || "The audio could not be uploaded. Try again.");
      logEvent("analysis.upload_failed", { code: error.code ?? "UNKNOWN" });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="recorder-workspace" aria-labelledby="recorder-title">
      <div className="workspace-copy">
        <p className="eyebrow">Your next take</p>
        <h1 id="recorder-title">Record or upload your audio</h1>
        <p>Get practical feedback on pace, pauses, and clarity—then make the next take better.</p>
      </div>

      <div className={`record-stage is-${status}`} aria-live="polite">
        <button className="record-control" disabled={pending || booting || recorder.status === "unsupported"} onClick={controlRecording} aria-label={recordingButtonLabel(recorder.status)}>
          {recorder.status === "recording" ? <Pause size={38} fill="currentColor" /> : <Mic size={44} />}
        </button>
        <strong className="record-time">{file ? "File ready" : formatTime(recorder.seconds)}</strong>
        <span className="record-status">{recordingStatus(status, pending)}</span>
        <div className="device-status">
          <span>{recorder.permission === "granted" ? <Check size={15} /> : <Mic size={15} />}Microphone {microphoneStatus(recorder.permission)}</span>
          <span>{finished ? <FileAudio size={15} /> : <Mic size={15} />}{file ? "Uploaded source selected" : "Record in this browser"}</span>
          <span><Check size={15} />Service validates format and duration</span>
        </div>
      </div>

      <div className="recorder-actions">
        {active && <button className="button button-secondary" disabled={pending} onClick={recorder.finish}><Square size={17} fill="currentColor" />Finish take</button>}
        {finished && <><button className="button button-quiet" disabled={pending} onClick={reset}><RotateCcw size={17} />Start over</button><button className="button button-primary" disabled={pending || Boolean(bootError)} onClick={analyze}>{pending ? "Uploading take" : "Analyze this take"}</button></>}
        {!active && !finished && <button className="button button-secondary upload-button" disabled={pending || booting} onClick={() => fileRef.current?.click()}><Upload size={18} />Upload audio file</button>}
        <input ref={fileRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/webm,.mp3,.wav,.m4a,.webm" onChange={handleUpload} aria-describedby="file-hint" hidden />
      </div>
      <p id="file-hint" className="file-hint">MP3, WAV, M4A, or WebM · maximum 25 MB · maximum 120 seconds</p>
      {recordingError && <p className="form-error" role="alert">{recordingError}</p>}
      <div className="input-facts" aria-label="Recording constraints">
        <span><ShieldCheck size={17} /><strong>Private</strong><small>{privacyCopy}</small></span>
        <span><Clock3 size={17} /><strong>120 sec</strong><small>Maximum take length</small></span>
        <span><Languages size={17} /><strong>English</strong><small>Analysis language</small></span>
      </div>
    </section>
  );
}

function recordingButtonLabel(status) {
  if (status === "recording") return "Pause recording";
  if (status === "paused") return "Resume recording";
  if (status === "unsupported") return "Recording is not supported";
  return "Start recording";
}

function recordingStatus(status, pending) {
  if (pending) return "Uploading audio…";
  if (status === "recording") return "Recording…";
  if (status === "paused") return "Paused";
  if (status === "complete") return "Take ready to analyze";
  if (status === "uploaded") return "Audio file ready";
  if (status === "denied") return "Microphone permission is required to record";
  if (status === "unsupported") return "Recording is not supported in this browser";
  if (status === "revoked") return "Microphone permission was revoked";
  if (status === "error") return "Recording needs attention";
  return "Ready when you are";
}

function microphoneStatus(permission) {
  if (permission === "granted") return "ready";
  if (permission === "denied") return "access denied";
  return "permission pending";
}

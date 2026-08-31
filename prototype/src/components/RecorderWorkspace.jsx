import { Check, Clock3, FileAudio, Languages, Mic, Pause, RotateCcw, ShieldCheck, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { logEvent } from "../lib/logEvent.js";

const MAX_SECONDS = 120;

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function RecorderWorkspace({ navigate }) {
  const [status, setStatus] = useState("ready");
  const [seconds, setSeconds] = useState(0);
  const fileRef = useRef(null);

  useEffect(() => {
    if (status !== "recording") return undefined;
    const timer = window.setInterval(() => {
      setSeconds((value) => Math.min(value + 1, MAX_SECONDS));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (seconds !== MAX_SECONDS) return;
    setStatus("complete");
    logEvent("recording.limit_reached", { durationSeconds: seconds });
  }, [seconds]);

  const toggleRecording = () => {
    const next = status === "recording" ? "paused" : "recording";
    setStatus(next);
    logEvent(`recording.${next}`, { durationSeconds: seconds, source: "mock" });
  };

  const finish = () => {
    const duration = seconds || 18;
    setSeconds(duration);
    setStatus("complete");
    logEvent("recording.completed", { durationSeconds: duration, source: "mock" });
  };

  const reset = () => {
    setSeconds(0);
    setStatus("ready");
    logEvent("recording.reset");
  };

  const analyze = () => {
    logEvent("analysis.requested", { input: status === "uploaded" ? "upload" : "recording" });
    navigate("/analysis/demo-processing");
  };

  const handleUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("uploaded");
    setSeconds(74);
    logEvent("upload.mock_selected", { mime: file.type || "unknown", sizeBytes: file.size });
  };

  const active = status === "recording" || status === "paused";
  const finished = status === "complete" || status === "uploaded";

  return (
    <section className="recorder-workspace" aria-labelledby="recorder-title">
      <div className="workspace-copy">
        <p className="eyebrow">Your next take</p>
        <h1 id="recorder-title">Record or upload your audio</h1>
        <p>Get practical feedback on pace, pauses, and clarity—then make the next take better.</p>
      </div>

      <div className={`record-stage is-${status}`} aria-live="polite">
        <button className="record-control" onClick={toggleRecording} aria-label={status === "recording" ? "Pause recording" : "Start recording"}>
          {status === "recording" ? <Pause size={38} fill="currentColor" /> : <Mic size={44} />}
        </button>
        <strong className="record-time">{formatTime(seconds)}</strong>
        <span className="record-status">
          {status === "ready" && "Ready when you are"}
          {status === "recording" && "Recording…"}
          {status === "paused" && "Paused"}
          {status === "complete" && "Take ready to analyze"}
          {status === "uploaded" && "Audio file ready"}
        </span>
        <div className="device-status">
          <span><Check size={15} />Microphone access</span>
          <span><Check size={15} />Good signal</span>
          <span>{finished ? <FileAudio size={15} /> : <Mic size={15} />}Mock input</span>
        </div>
      </div>

      <div className="recorder-actions">
        {active && (
          <button className="button button-secondary" onClick={finish}><Square size={17} fill="currentColor" />Finish take</button>
        )}
        {finished && (
          <>
            <button className="button button-quiet" onClick={reset}><RotateCcw size={17} />Start over</button>
            <button className="button button-primary" onClick={analyze}>Analyze this take</button>
          </>
        )}
        {!active && !finished && (
          <button className="button button-secondary upload-button" onClick={() => fileRef.current?.click()}><Upload size={18} />Upload audio file</button>
        )}
        <input ref={fileRef} type="file" accept="audio/*" onChange={handleUpload} hidden />
      </div>
      <p className="file-hint">MP3, WAV, M4A or WebM · 30–120 seconds · Mock flow</p>
      <div className="input-facts" aria-label="Recording constraints">
        <span><ShieldCheck size={17} /><strong>Private</strong><small>Audio deleted by default</small></span>
        <span><Clock3 size={17} /><strong>120 sec</strong><small>Maximum take length</small></span>
        <span><Languages size={17} /><strong>English</strong><small>Analysis language</small></span>
      </div>
    </section>
  );
}

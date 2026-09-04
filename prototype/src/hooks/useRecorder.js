import { useCallback, useEffect, useRef, useState } from "react";
import { logEvent } from "../lib/logEvent.js";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

/** 统一管理浏览器麦克风权限、MediaRecorder 生命周期和音频 Blob。 */
export function useRecorder(maxSeconds = 120) {
  const [state, setState] = useState(initialState);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);

  const revokeActive = useCallback(() => abortRecorder(recorderRef, streamRef), []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return setState((value) => ({ ...value, status: "unsupported", error: "Recording is not supported in this browser." }));
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startRecorder(stream, { recorderRef, streamRef, chunksRef, startedAtRef, elapsedRef, setState });
    } catch (error) {
      const denied = error.name === "NotAllowedError" || error.name === "SecurityError";
      setState((value) => ({ ...value, status: denied ? "denied" : "error", permission: denied ? "denied" : value.permission,
        error: denied ? "Microphone access was denied. Allow it in browser settings and try again." : "The microphone could not be started." }));
      logEvent("recording.start_failed", { code: error.name ?? "UNKNOWN" });
    }
  }, []);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "recording") return;
    recorder.pause();
    elapsedRef.current += Date.now() - startedAtRef.current;
    setState((value) => ({ ...value, status: "paused" }));
    logEvent("recording.paused");
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "paused") return;
    recorder.resume();
    startedAtRef.current = Date.now();
    setState((value) => ({ ...value, status: "recording" }));
    logEvent("recording.resumed");
  }, []);

  const finish = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "recording") elapsedRef.current += Date.now() - startedAtRef.current;
    recorder.stop();
  }, []);

  const reset = useCallback(() => {
    abortRecorder(recorderRef, streamRef);
    chunksRef.current = [];
    elapsedRef.current = 0;
    setState(initialState());
    logEvent("recording.reset");
  }, []);

  usePermissionWatch(setState, revokeActive);
  useElapsedTimer(state.status, maxSeconds, setState, finish);
  useEffect(() => () => abortRecorder(recorderRef, streamRef), []);
  return { ...state, start, pause, resume, finish, reset };
}

function initialState() {
  return { status: "ready", permission: "prompt", seconds: 0, blob: null, error: "" };
}

function startRecorder(stream, refs) {
  const mimeType = supportedMime();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  refs.streamRef.current = stream;
  refs.recorderRef.current = recorder;
  refs.chunksRef.current = [];
  refs.elapsedRef.current = 0;
  refs.startedAtRef.current = Date.now();
  recorder.ondataavailable = (event) => event.data.size && refs.chunksRef.current.push(event.data);
  recorder.onstop = () => completeRecording(recorder, refs);
  recorder.onerror = () => refs.setState((value) => ({ ...value, status: "error", error: "Recording stopped unexpectedly." }));
  recorder.start(500);
  refs.setState({ status: "recording", permission: "granted", seconds: 0, blob: null, error: "" });
  logEvent("recording.started", { mimeType: recorder.mimeType || "browser-default" });
}

function completeRecording(recorder, refs) {
  const blob = new Blob(refs.chunksRef.current, { type: recorder.mimeType || "audio/webm" });
  stopTracks(refs.streamRef.current);
  refs.streamRef.current = null;
  const seconds = Math.max(1, Math.round(refs.elapsedRef.current / 1000));
  refs.setState((value) => ({ ...value, status: blob.size ? "complete" : "error", seconds, blob,
    error: blob.size ? "" : "No audio was captured. Check the microphone and try again." }));
  logEvent("recording.completed", { durationSeconds: seconds, sizeBytes: blob.size });
}

function useElapsedTimer(status, maxSeconds, setState, finish) {
  useEffect(() => {
    if (status !== "recording") return undefined;
    const timer = window.setInterval(() => setState((value) => {
      const seconds = Math.min(value.seconds + 1, maxSeconds);
      if (seconds === maxSeconds) window.setTimeout(finish, 0);
      return { ...value, seconds };
    }), 1000);
    return () => window.clearInterval(timer);
  }, [status, maxSeconds, setState, finish]);
}

function usePermissionWatch(setState, onRevoked) {
  useEffect(() => {
    if (!navigator.permissions?.query) return undefined;
    let permission;
    let handleChange;
    let active = true;
    navigator.permissions.query({ name: "microphone" }).then((result) => {
      if (!active) return;
      permission = result;
      handleChange = () => {
        setState((value) => ({ ...value, permission: result.state,
          status: result.state === "denied" && ["recording", "paused"].includes(value.status) ? "revoked" : value.status,
          error: result.state === "denied" ? "Microphone permission was revoked. Allow it before recording again." : value.error }));
        if (result.state === "denied") onRevoked();
      };
      result.addEventListener("change", handleChange);
      handleChange();
    }).catch(() => undefined);
    return () => {
      active = false;
      if (permission && handleChange) permission.removeEventListener("change", handleChange);
    };
  }, [setState, onRevoked]);
}

function supportedMime() {
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

function abortRecorder(recorderRef, streamRef) {
  if (recorderRef.current && recorderRef.current.state !== "inactive") {
    recorderRef.current.onstop = null;
    recorderRef.current.stop();
  }
  stopTracks(streamRef.current);
  recorderRef.current = null;
  streamRef.current = null;
}

function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

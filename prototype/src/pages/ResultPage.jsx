import {
  ArrowLeft,
  AudioLines,
  Clock3,
  Gauge,
  Mic,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { logEvent } from "../lib/logEvent.js";

const DURATION_SECONDS = 92;

const transcript = [
  { seconds: 0, time: "00:00", text: "Hey everyone, I’m excited to share what we’ve been building." },
  { seconds: 5, time: "00:05", text: "Today we’re launching Product 2.0, our biggest update yet." },
  { seconds: 11, time: "00:11", text: "It’s faster, simpler, and built for the way you actually work." },
  { seconds: 17, time: "00:17", text: "First, performance." },
  { seconds: 23, time: "00:23", text: "We cut load times by 40 percent so things feel instant." },
  { seconds: 29, time: "00:29", text: "Second, collaboration." },
  { seconds: 35, time: "00:35", text: "Teams can now work together in real time without leaving the flow." },
  { seconds: 41, time: "00:41", text: "And third, insights." },
  { seconds: 47, time: "00:47", text: "You’ll see clearer data that helps you make better decisions." },
  {
    seconds: 54,
    time: "00:54",
    before: "So, ",
    issue: "um",
    after: ", how does this help you day to day?",
    signal: "2.3s pause",
    tone: "red",
  },
  { seconds: 60, time: "01:00", text: "Well, you’ll save time, ship more, and focus on what matters." },
  {
    seconds: 67,
    time: "01:07",
    before: "We’ve heard your feedback and, ",
    issue: "uh",
    after: ", this release is full of those requests.",
    signal: "2.6s pause",
    tone: "amber",
  },
  { seconds: 73, time: "01:13", text: "Over the next week, you’ll see the update roll out to everyone." },
  { seconds: 79, time: "01:19", text: "Thank you for being part of this journey." },
  {
    seconds: 86,
    time: "01:26",
    text: "We can’t wait to see what you build next.",
    signal: "Opening landed 18s late",
    tone: "green",
  },
];

const actions = [
  {
    id: "fillers",
    rank: "1",
    title: "Replace fillers with a beat",
    impact: "High impact",
    tone: "red",
    finding: "Two fillers interrupt your transitions.",
    evidence: [54, 67],
    cue: "Pause once, then ask the audience what changes for them.",
    rewrite: "So, how does this help you day to day?",
  },
  {
    id: "pauses",
    rank: "2",
    title: "Tighten long pauses",
    impact: "Medium impact",
    tone: "amber",
    finding: "Two transition pauses run longer than 2 seconds.",
    evidence: [54, 67],
    cue: "Finish each list label, breathe, then continue within one beat.",
    rewrite: "Second, collaboration. Teams can now work together in real time.",
  },
  {
    id: "opening",
    rank: "3",
    title: "Land the outcome earlier",
    impact: "Keep practicing",
    tone: "green",
    finding: "The listener benefit arrives 18 seconds into the take.",
    evidence: [0],
    cue: "Lead with the outcome before describing the release.",
    rewrite: "Product 2.0 helps your team ship faster with less friction.",
  },
];

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.min(DURATION_SECONDS, totalSeconds));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function Waveform({ currentTime, onSeek }) {
  const canvasRef = useRef(null);
  const played = currentTime / DURATION_SECONDS;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
    canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
    context.scale(ratio, ratio);
    context.clearRect(0, 0, bounds.width, bounds.height);

    const center = bounds.height / 2;
    const bars = 132;
    const gap = bounds.width / bars;
    for (let index = 0; index < bars; index += 1) {
      const x = index * gap + gap / 2;
      const envelope = 0.44 + Math.sin(index * 0.19) * 0.2 + Math.sin(index * 0.71) * 0.17;
      const height = Math.max(4, Math.min(28, Math.abs(envelope) * 34));
      const quietSegment = (index > 51 && index < 66) || (index > 91 && index < 103) || index > 121;
      context.strokeStyle = index / bars <= played ? "#155eef" : quietSegment ? "#d7e2f7" : "#4b82ee";
      context.lineWidth = Math.max(1.4, gap * 0.33);
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(x, center - height / 2);
      context.lineTo(x, center + height / 2);
      context.stroke();
    }

    const markerX = played * bounds.width;
    context.strokeStyle = "#155eef";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(markerX, 2);
    context.lineTo(markerX, bounds.height - 2);
    context.stroke();
    return undefined;
  }, [currentTime]);

  const seek = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeek(Math.round(((event.clientX - bounds.left) / bounds.width) * DURATION_SECONDS));
  };

  return (
    <button className="analysis-waveform" onClick={seek} aria-label={`Audio timeline, current time ${formatTime(currentTime)}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="waveform-current" style={{ left: `${played * 100}%` }}>{formatTime(currentTime)}</span>
      <span className="waveform-ticks" aria-hidden="true">
        {[
          ["00:00", 0], ["00:15", 15], ["00:30", 30], ["00:45", 45],
          ["01:00", 60], ["01:15", 75], ["01:32", 92],
        ].map(([label, seconds]) => <span key={label} style={{ left: `${(seconds / DURATION_SECONDS) * 100}%` }}>{label}</span>)}
      </span>
    </button>
  );
}

function SessionSummary() {
  return (
    <div className="session-summary" aria-label="Session summary">
      <span><Clock3 size={19} /><small>Duration</small><strong>01:32</strong></span>
      <span><Gauge size={19} /><small>Speaking pace</small><strong>148 WPM</strong></span>
      <span><AudioLines size={19} /><small>Total words</small><strong>236</strong></span>
    </div>
  );
}

function PracticeDialog({ action, onClose }) {
  const [script, setScript] = useState(action.rewrite);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => Math.min(30, value + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (seconds === 30) setRecording(false);
  }, [seconds]);

  return (
    <div className="practice-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="practice-dialog" role="dialog" aria-modal="true" aria-labelledby="practice-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button practice-close" onClick={onClose} aria-label="Close practice"><X size={20} /></button>
        <p className="eyebrow">Focused practice · up to 30 seconds</p>
        <h2 id="practice-title">{action.title}</h2>
        <p>Rehearse the improved line, then record it while the cue is fresh.</p>
        <label className="practice-script">
          <span>Your improved line</span>
          <textarea value={script} onChange={(event) => setScript(event.target.value)} rows="3" />
        </label>
        <div className="practice-cue"><Target size={19} /><span><strong>Coach cue</strong>{action.cue}</span></div>
        <button
          className={recording ? "practice-record is-recording" : "practice-record"}
          onClick={() => {
            setRecording((value) => !value);
            logEvent(recording ? "practice.paused" : "practice.started", { action: action.id });
          }}
        >
          {recording ? <Pause size={26} fill="currentColor" /> : <Mic size={29} />}
          <span>{recording ? "Pause practice take" : seconds ? "Continue practice take" : "Start practice take"}</span>
          <strong>{formatTime(seconds)} / 00:30</strong>
        </button>
        <button className="button button-secondary" onClick={onClose}>Save draft and return</button>
      </section>
    </div>
  );
}

function PriorityCard({ action, active, onSelect, onEvidence }) {
  return (
    <article className={`coach-priority-card tone-${action.tone}${active ? " is-active" : ""}`}>
      <button className="priority-card-heading" onClick={onSelect} aria-pressed={active}>
        <span className="coach-priority-rank">{action.rank}</span>
        <strong>{action.title}</strong>
        <small>{action.impact}</small>
      </button>
      <div className="priority-card-body">
        <span className="detail-label">Finding</span>
        <p>{action.finding}</p>
        <span className="detail-label">Evidence</span>
        <div className="evidence-links">
          {action.evidence.map((seconds) => (
            <button key={seconds} onClick={() => onEvidence(seconds)}>{formatTime(seconds)}</button>
          ))}
        </div>
        <span className="detail-label">Next-take cue</span>
        <p>{action.cue}</p>
        <blockquote>{action.rewrite}</blockquote>
      </div>
    </article>
  );
}

export function ResultPage({ navigate }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeActionId, setActiveActionId] = useState("fillers");
  const [practiceOpen, setPracticeOpen] = useState(false);
  const activeAction = useMemo(() => actions.find((item) => item.id === activeActionId) || actions[0], [activeActionId]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setInterval(() => {
      setCurrentTime((value) => {
        if (value >= DURATION_SECONDS) {
          setIsPlaying(false);
          return 0;
        }
        return value + playbackRate;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackRate]);

  const focusEvidence = (seconds) => {
    setCurrentTime(seconds);
    setSelectedEvidence(seconds);
    document.getElementById(`transcript-${seconds}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    logEvent("analysis.evidence_selected", { seconds });
  };

  const startRetake = () => {
    window.sessionStorage.setItem("speechOptimizer.retakeCue", activeAction.cue);
    logEvent("retake.started", { action: activeAction.id });
    navigate("/");
  };

  return (
    <div className="analysis-workspace">
      <section className="transcript-workspace" aria-labelledby="analysis-title">
        <header className="analysis-heading">
          <button className="back-button" onClick={() => navigate("/history")}><ArrowLeft size={17} />Back to sessions</button>
          <div className="analysis-title-row">
            <div>
              <h1 id="analysis-title">Launch update — Product 2.0</h1>
              <p className="analysis-recorded">Recorded September 2, 2026 at 10:15 AM</p>
            </div>
            <SessionSummary />
          </div>
          <Waveform currentTime={currentTime} onSeek={setCurrentTime} />
        </header>

        <div className="transcript-table" aria-label="Timestamped transcript">
          {transcript.map((row) => (
            <button
              id={`transcript-${row.seconds}`}
              className={`transcript-row${selectedEvidence === row.seconds ? " is-selected" : ""}${row.tone ? ` tone-${row.tone}` : ""}`}
              key={row.seconds}
              onClick={() => focusEvidence(row.seconds)}
            >
              <time>{row.time}</time>
              <span className="transcript-copy">
                {row.before}
                {row.issue && <mark>{row.issue}</mark>}
                {row.after}
                {row.text}
              </span>
              <span className="transcript-signal">{row.signal || ""}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="coach-rail" aria-labelledby="priority-title">
        <div className="coach-rail-heading">
          <div><p className="eyebrow">Start here</p><h2 id="priority-title">3 prioritized actions</h2></div>
          <span><Sparkles size={17} />Evidence based</span>
        </div>
        <div className="coach-priority-list">
          {actions.map((action) => (
            <PriorityCard
              key={action.id}
              action={action}
              active={activeActionId === action.id}
              onSelect={() => setActiveActionId(action.id)}
              onEvidence={focusEvidence}
            />
          ))}
        </div>
      </aside>

      <div className="analysis-player" aria-label="Audio and practice controls">
        <button className="player-control" onClick={() => setIsPlaying((value) => !value)} aria-label={isPlaying ? "Pause audio" : "Play audio"}>
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button className="skip-control" onClick={() => setCurrentTime((value) => Math.max(0, value - 10))} aria-label="Back 10 seconds"><RotateCcw size={18} />10</button>
        <span className="player-time">{formatTime(currentTime)} / 01:32</span>
        <button className="skip-control" onClick={() => setCurrentTime((value) => Math.min(DURATION_SECONDS, value + 10))} aria-label="Forward 10 seconds"><RotateCw size={18} />10</button>
        <button
          className="speed-control"
          onClick={() => setPlaybackRate((value) => (value === 1 ? 1.25 : value === 1.25 ? 1.5 : 1))}
          aria-label={`Playback speed ${playbackRate} times`}
        >
          {playbackRate}x
        </button>
        <button className="button button-secondary player-evidence" onClick={() => focusEvidence(activeAction.evidence[0])}><AudioLines size={17} />Play evidence</button>
        <button className="button button-secondary player-practice" onClick={() => setPracticeOpen(true)}><Target size={17} />Practice selected section</button>
        <button className="button button-primary player-primary" onClick={startRetake}><Mic size={18} />Record improved take</button>
      </div>

      {practiceOpen && <PracticeDialog action={activeAction} onClose={() => setPracticeOpen(false)} />}
    </div>
  );
}

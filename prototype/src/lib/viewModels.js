const STATUS_LABELS = {
  created: "Waiting for audio",
  uploaded: "Queued",
  transcribing: "Transcribing",
  analyzing: "Building feedback",
  completed: "Complete",
  failed: "Needs retry",
  cancelled: "Cancelled",
};

export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return "--";
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function historyRow(item) {
  return {
    ...item,
    title: `Speech take ${item.id.slice(0, 8)}`,
    date: new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    duration: formatDuration(item.durationMs),
    statusLabel: STATUS_LABELS[item.status] ?? item.status,
  };
}

export function reportMetrics(report) {
  const metrics = report?.report?.metrics ?? report?.metrics;
  if (!metrics) return [];
  return [
    { label: "Speaking rate", value: metrics.wordsPerMinute, unit: "WPM", state: paceState(metrics.wordsPerMinute) },
    { label: "Filler words", value: metrics.fillers?.total ?? 0, unit: "total", state: `${metrics.fillers?.perMinute ?? 0} per min` },
    { label: "Long pauses", value: metrics.longPauses?.length ?? 0, unit: "over 3s", state: "Review" },
    { label: "Effective speech", value: formatDuration((metrics.effectiveSpeakingSeconds ?? 0) * 1000), unit: "spoken", state: `${metrics.wordCount ?? 0} words` },
  ];
}

export function reportFeedback(report) {
  return report?.report?.feedback ?? report?.feedback ?? [];
}

function paceState(value) {
  if (value < 120) return "Measured pace";
  if (value > 170) return "Fast pace";
  return "Within target";
}

export function money(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format((amount ?? 0) / 100);
}

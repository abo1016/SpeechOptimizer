import {
  Activity,
  CreditCard,
  FileClock,
  Gauge,
  History,
  LayoutDashboard,
  MessagesSquare,
  Pause,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

// 导航配置只描述原型信息架构，避免在组件中重复维护路径和文案。
export const primaryNavigation = [
  { label: "Coach", path: "/", icon: Sparkles },
  { label: "History", path: "/history", icon: History },
  { label: "Pricing", path: "/pricing", icon: CreditCard },
  { label: "Contact", path: "/contact", icon: MessagesSquare },
];

export const accountNavigation = [
  { label: "Billing", path: "/settings/billing", icon: FileClock },
  { label: "Privacy", path: "/settings/privacy", icon: ShieldCheck },
  { label: "Admin", path: "/admin", icon: LayoutDashboard },
];

export const feedbackPreview = [
  {
    title: "Speaking rate",
    description: "Find a pace that keeps listeners with you from start to finish.",
    evidence: "Aim for a steady 120–150 words per minute.",
    icon: Gauge,
    tone: "success",
  },
  {
    title: "Filler words",
    description: "Spot the words that dilute your message and credibility.",
    evidence: "Pause instead of reaching for “um” or “like.”",
    icon: Activity,
    tone: "warning",
  },
  {
    title: "Long pauses",
    description: "See where hesitation interrupts your audience’s attention.",
    evidence: "Tighten transitions around pauses over 3 seconds.",
    icon: Pause,
    tone: "danger",
  },
];

export const sessions = [
  { title: "YouTube Short — Clearer openings", date: "Aug 30, 2026", duration: "1:42", score: 78, status: "Good" },
  { title: "Podcast intro — Episode 23", date: "Aug 28, 2026", duration: "1:18", score: 62, status: "Needs work" },
  { title: "Creator update — Product launch", date: "Aug 24, 2026", duration: "1:56", score: 85, status: "Great" },
];

export const priorities = [
  {
    rank: "01",
    title: "Land the opening sooner",
    finding: "Your main point arrives 18 seconds into a 92-second take.",
    action: "State the outcome in your first sentence, then add context.",
    cue: "Try: “Three small changes made my videos easier to follow.”",
    tone: "blue",
  },
  {
    rank: "02",
    title: "Replace fillers with a beat",
    finding: "You used 8 fillers, mostly before transitions.",
    action: "Leave a short silent beat before each new point.",
    cue: "Re-record the transition at 00:34 without “um.”",
    tone: "amber",
  },
  {
    rank: "03",
    title: "Slow the final third",
    finding: "Your pace rises from 142 to 171 WPM after 01:02.",
    action: "Shorten the last two sentences and stress the key verbs.",
    cue: "Aim for 145 WPM from 01:02 to the end.",
    tone: "green",
  },
];

export const metrics = [
  { label: "Speaking rate", value: "154", unit: "WPM", state: "Slightly fast" },
  { label: "Filler words", value: "8", unit: "total", state: "5.2 per min" },
  { label: "Long pauses", value: "4", unit: "over 3s", state: "Review" },
  { label: "Effective speech", value: "1:19", unit: "of 1:32", state: "86%" },
];

export const comparisonMetrics = [
  { label: "Speaking rate", before: "171 WPM", after: "146 WPM", delta: "Closer to target" },
  { label: "Filler words", before: "8", after: "3", delta: "5 fewer" },
  { label: "Long pauses", before: "4", after: "2", delta: "2 fewer" },
  { label: "Effective speech", before: "86%", after: "89%", delta: "+3%" },
];

// 次级页面集中定义，便于后续替换为正式路由组件或真实内容。
export const routeTable = {
  "/history": { kind: "history", title: "History", eyebrow: "Your sessions" },
  "/pricing": { kind: "pricing", title: "Choose how you practice", eyebrow: "Plans" },
  "/settings/billing": { kind: "billing", title: "Billing & minutes", eyebrow: "Settings" },
  "/settings/privacy": { kind: "privacy", title: "Privacy controls", eyebrow: "Settings" },
  "/admin": { kind: "admin", title: "Operations overview", eyebrow: "Admin" },
  "/contact": { kind: "contact", title: "Contact us", eyebrow: "Support" },
  "/privacy": { kind: "legal", title: "Privacy policy", eyebrow: "Legal draft" },
  "/terms": { kind: "legal", title: "Terms of service", eyebrow: "Legal draft" },
  "/refund-policy": { kind: "legal", title: "Refund policy", eyebrow: "Legal draft" },
  "/data-deletion": { kind: "legal", title: "Data deletion", eyebrow: "Legal draft" },
};

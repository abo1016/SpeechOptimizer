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

// 次级页面只集中维护信息架构；业务数据由各页面的真实 API 请求提供。
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

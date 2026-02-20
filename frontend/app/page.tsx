"use client"

import { useState } from "react"
import { Settings } from "lucide-react"
import ChatPanel from "@/components/ChatPanel"
import SettingsModal from "@/components/SettingsModal"
import LeftDashboard from "@/components/LeftDashboard"
import AlertDashboard from "@/components/AlertDashboard"
import IncidentTracker from "@/components/IncidentTracker"
import ExtendedAnalytics from "@/components/ExtendedAnalytics"

type Tab = "control" | "analytics" | "tracker"

const TABS: { id: Tab; label: string }[] = [
  { id: "control",   label: "Control Center" },
  { id: "analytics", label: "Extended Analytics" },
  { id: "tracker",   label: "Incident Tracker" },
]

export default function Home() {
  const [activeTab, setActiveTab]           = useState<Tab>("control")
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Extended Analytics is full-width, no chat panel
  const isFullWidth = activeTab === "analytics"

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: "var(--bg)" }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="flex h-11 shrink-0 items-center justify-between border-b px-4 gap-6"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        {/* Logo — respects theme text color */}
        <span
          className="font-mono text-base font-bold tracking-wide shrink-0"
          style={{ color: "var(--text)", letterSpacing: "0.03em" }}
        >
          Safety AnalystBot
        </span>

        {/* Tab nav */}
        <nav className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95"
                style={{
                  color:      active ? "var(--accent)" : "var(--text-muted)",
                  background: active ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                  border:     `1px solid ${active ? "color-mix(in srgb, var(--accent) 35%, transparent)" : "transparent"}`,
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </nav>

        {/* Settings */}
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="shrink-0 rounded-lg p-1.5 transition-all active:scale-95 cursor-pointer"
          style={{ color: "var(--text-muted)" }}
          aria-label="Open settings"
          onMouseOver={e => (e.currentTarget.style.color = "var(--accent)")}
          onMouseOut={e  => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Extended Analytics — full width, no chat */}
        {isFullWidth && (
          <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "var(--surface)" }}>
            <ExtendedAnalytics />
          </div>
        )}

        {/* Control Center + Incident Tracker — split layout */}
        {!isFullWidth && (
          <>
            {/* Left panel */}
            <div
              className="flex w-[55%] flex-col overflow-hidden border-r"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              {activeTab === "control" && <LeftDashboard />}
              {activeTab === "tracker" && <IncidentTracker />}
            </div>

            {/* Right panel */}
            <div
              className="flex w-[45%] flex-col overflow-hidden"
              style={{ background: "var(--surface)" }}
            >
              {activeTab === "tracker" ? <AlertDashboard /> : <ChatPanel />}
            </div>
          </>
        )}
      </div>

      <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  )
}

// ── Analytics placeholder ──────────────────────────────────────────────────────

function AnalyticsPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-12">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl border"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" style={{ color: "var(--text-muted)" }}>
          <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M7 16l4-4 4 4 4-8" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Extended Analytics
        </p>
        <p className="text-xs max-w-xs" style={{ color: "var(--text-muted)" }}>
          Your teammate is building this section. Drop their component in here when ready —
          replace <code className="px-1 rounded" style={{ background: "var(--card)" }}>AnalyticsPlaceholder</code> in{" "}
          <code className="px-1 rounded" style={{ background: "var(--card)" }}>page.tsx</code>.
        </p>
      </div>
    </div>
  )
}

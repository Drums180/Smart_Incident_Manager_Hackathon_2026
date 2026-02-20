"use client"

import { useState } from "react"
import { Settings } from "lucide-react"
import ChatPanel from "@/components/ChatPanel"
import SettingsModal from "@/components/SettingsModal"
import LeftDashboard from "@/components/LeftDashboard"

export default function Home() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header
        className="flex h-10 shrink-0 items-center justify-between border-b px-4"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <span
          className="text-base font-bold"
          style={{ color: "var(--text)", fontFamily: "var(--font-geist-sans)" }}
        >
          Safety AnalystBot
        </span>

        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="rounded-lg p-1.5 transition-all duration-150 hover:bg-white/10 hover:text-blue-400 active:bg-white/15 active:scale-95 cursor-pointer"
          style={{ color: "var(--text-muted)" }}
          aria-label="Open settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {/* Main panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — dashboard */}
        <div
          className="flex w-[55%] items-stretch border-r"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <LeftDashboard />
        </div>

        {/* Right — chat */}
        <div
          className="flex w-[45%] flex-col overflow-hidden"
          style={{ background: "var(--surface)" }}
        >
          <ChatPanel />
        </div>
      </div>

      <SettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  )
}

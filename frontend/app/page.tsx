"use client"

import { useState } from "react"
import { Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import ChatPanel from "@/components/ChatPanel"
import SettingsModal from "@/components/SettingsModal"

export default function Home() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header
        className="flex h-10 shrink-0 flex-row items-center justify-between border-b px-4"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <span
          className="font-mono text-sm font-semibold"
          style={{ color: "var(--text)" }}
        >
          Safety AnalystBot
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsSettingsOpen(true)}
          className="text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </header>

      {/* Main content */}
      <div className="flex flex-1 flex-row overflow-hidden">
        {/* Left panel */}
        <div
          className="flex w-[55%] items-center justify-center border-r"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Dashboard Panel
          </p>
        </div>

        {/* Right panel */}
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

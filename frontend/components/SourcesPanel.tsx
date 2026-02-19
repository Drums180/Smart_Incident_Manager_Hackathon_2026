"use client"

import { useState } from "react"
import type { Source } from "@/lib/types"

const SEVERITY_COLORS: Record<string, string> = {
  Major: "#ef4444",
  Serious: "#f97316",
  "Potentially Significant": "#eab308",
  "Near Miss": "#3b82f6",
  Minor: "#6b7280",
}

function severityColor(severity: string): string {
  return SEVERITY_COLORS[severity] ?? "#9ca3af"
}

interface SourcesPanelProps {
  sources: Source[]
}

export default function SourcesPanel({ sources }: SourcesPanelProps) {
  const [expanded, setExpanded] = useState(false)

  if (sources.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="cursor-pointer text-xs transition-colors hover:text-white"
        style={{ color: "var(--text-muted)" }}
      >
        {expanded ? "▾" : "▸"} {sources.length} sources used
      </button>
      {expanded && (
        <ul className="flex flex-col gap-2">
          {sources.map((s) => (
            <li
              key={s.record_id + s.section}
              className="rounded border p-2 text-xs"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border)",
              }}
            >
              <div className="font-mono text-white">
                #{s.record_id} · {(s.title ?? "").slice(0, 45)}
                {(s.title?.length ?? 0) > 45 ? "…" : ""}
              </div>
              <div style={{ color: "var(--text-muted)" }}>
                {s.location} · {s.year} · {s.section}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: severityColor(s.severity) }}
                />
                <span style={{ color: severityColor(s.severity) }}>{s.severity}</span>
                <div
                  className="h-1 flex-1 rounded"
                  style={{ background: "var(--border)" }}
                >
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.min(100, Math.max(0, s.score * 100))}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

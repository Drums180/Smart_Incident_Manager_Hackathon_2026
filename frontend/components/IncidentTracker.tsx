"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { RefreshCw, XCircle, AlertTriangle, Upload, FileText, Loader2, X, ChevronDown } from "lucide-react"
import { listAlerts, analyzePdfSeverity } from "@/lib/api"
import type { AlertLog } from "@/lib/types"
import { BASE_URL } from "@/lib/api"

function formatTime(iso: string) {
  const d    = new Date(iso)
  const diff = Date.now() - d.getTime()
  const m    = Math.floor(diff / 60000)
  if (m < 1)  return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function SeverityBar({ confidence, label }: { confidence: number; label: string }) {
  const isHigh = label === "High Severity"
  const color  = isHigh
    ? confidence >= 0.85 ? "#ef4444" : "#f97316"
    : confidence >= 0.7  ? "#f59e0b" : "#6b7280"
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(128,128,128,0.15)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.round(confidence * 100)}%`, background: color }} />
      </div>
      <span className="text-[10px] shrink-0 font-medium tabular-nums" style={{ color }}>
        {Math.round(confidence * 100)}%
      </span>
    </div>
  )
}

type HumanStatus = "pending" | "reviewed" | "escalated" | "resolved"

// ── Manual upload panel ────────────────────────────────────────────────────────

interface UploadPanelProps {
  onUploaded: () => void
}

function ManualUploadPanel({ onUploaded }: UploadPanelProps) {
  const fileRef    = useRef<HTMLInputElement>(null)
  const [file,     setFile]     = useState<File | null>(null)
  const [status,   setStatus]   = useState<"idle" | "uploading" | "done" | "error">("idle")
  const [message,  setMessage]  = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = (f: File) => {
    const ok = f.name.endsWith(".pdf") || f.name.endsWith(".csv")
    if (!ok) { setMessage("Only PDF or CSV files accepted."); return }
    setFile(f)
    setMessage(null)
    setStatus("idle")
  }

  const handleSubmit = async () => {
    if (!file) return
    setStatus("uploading")
    setMessage(null)
    try {
      // Drop file into incidents/incoming via the backend watch-folder endpoint
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`${BASE_URL}/api/incidents/upload`, { method: "POST", body: fd })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setStatus("done")
      setMessage(`✓ ${file.name} submitted — severity: ${data.severity_label} (${Math.round(data.confidence * 100)}%)`)
      setFile(null)
      setTimeout(() => { setStatus("idle"); setMessage(null); onUploaded() }, 3000)
    } catch (e: any) {
      setStatus("error")
      setMessage(e?.message ?? "Upload failed")
    }
  }

  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-2"
         style={{ color: "var(--text-muted)" }}>Submit Incident File</p>

      <div
        className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 transition-all"
        style={{
          borderColor: isDragging ? "var(--accent)" : file ? "rgba(59,130,246,0.4)" : "var(--border)",
          background:  isDragging ? "rgba(59,130,246,0.06)" : "var(--card)",
        }}
        onClick={() => fileRef.current?.click()}
        onDragOver={e  => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
      >
        <input ref={fileRef} type="file" accept=".pdf,.csv" className="hidden"
               onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
             style={{ background: file ? "rgba(59,130,246,0.12)" : "rgba(128,128,128,0.08)" }}>
          <FileText className="h-4 w-4" style={{ color: file ? "var(--accent)" : "var(--text-muted)" }} />
        </div>
        <div className="flex min-w-0 flex-col">
          {file ? (
            <>
              <span className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>{file.name}</span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {(file.size / 1024).toFixed(1)} KB · click to replace
              </span>
            </>
          ) : (
            <>
              <span className="text-xs font-medium" style={{ color: "var(--text)" }}>Drop PDF or CSV</span>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Will be scored instantly and appear below
              </span>
            </>
          )}
        </div>
        {file && (
          <button type="button" onClick={e => { e.stopPropagation(); setFile(null); setMessage(null) }}
                  className="ml-auto rounded p-0.5 hover:bg-white/10 shrink-0"
                  style={{ color: "var(--text-muted)" }}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {file && status !== "done" && (
        <button type="button" onClick={handleSubmit} disabled={status === "uploading"}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}>
          {status === "uploading"
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…</>
            : <><Upload className="h-3.5 w-3.5" /> Submit for Analysis</>}
        </button>
      )}

      {message && (
        <p className="mt-1.5 text-[10px]"
           style={{ color: status === "done" ? "#4ade80" : status === "error" ? "#f87171" : "var(--text-muted)" }}>
          {message}
        </p>
      )}

      <p className="mt-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
        💡 Files dropped in <code className="px-1 rounded" style={{ background: "var(--card)" }}>incidents/incoming/</code> are also auto-picked up every 15 s.
      </p>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function IncidentTracker() {
  const [alerts,      setAlerts]      = useState<AlertLog[]>([])
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [statusMap,   setStatusMap]   = useState<Record<string, HumanStatus>>({})
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set())
  const [filter,      setFilter]      = useState<"all" | "sent" | "suppressed">("all")
  const [showUpload,  setShowUpload]  = useState(false)

  const loadAlerts = useCallback(async () => {
    try {
      const data = await listAlerts()
      setAlerts(data)
      setLastUpdated(new Date())
      setStatusMap(prev => {
        const next = { ...prev }
        let changed = false
        for (const a of data) {
          if (!(a.id in next)) { next[a.id] = "pending"; changed = true }
        }
        return changed ? next : prev
      })
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => {
    loadAlerts()
    const id = setInterval(loadAlerts, 15000)
    return () => clearInterval(id)
  }, [loadAlerts])

  const setHumanStatus = (id: string, s: HumanStatus) =>
    setStatusMap(prev => ({ ...prev, [id]: s }))

  const visibleAlerts = alerts
    .filter(a => !dismissed.has(a.id))
    .filter(a => {
      if (filter === "sent")       return a.status === "sent"
      if (filter === "suppressed") return a.status === "suppressed"
      return true
    })

  const sentCount       = alerts.filter(a => a.status === "sent").length
  const suppressedCount = alerts.filter(a => a.status === "suppressed").length
  const pendingReview   = Object.values(statusMap).filter(s => s === "pending").length

  const STATUS_COLORS: Record<HumanStatus, string> = {
    pending:   "#fbbf24", reviewed: "#4ade80",
    escalated: "#f87171", resolved: "#60a5fa",
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0"
           style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Incident Tracker</span>
          {lastUpdated && (
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Updated {formatTime(lastUpdated.toISOString())}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle upload panel */}
          <button type="button"
                  onClick={() => setShowUpload(v => !v)}
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all hover:bg-white/8 active:scale-95"
                  style={{
                    borderColor: showUpload ? "rgba(59,130,246,0.4)" : "var(--border)",
                    color:       showUpload ? "var(--accent)" : "var(--text-muted)",
                    background:  showUpload ? "rgba(59,130,246,0.08)" : "transparent",
                  }}>
            <Upload className="h-3.5 w-3.5" />
            Submit File
          </button>
          <button type="button" onClick={loadAlerts}
                  className="rounded-lg p-1.5 transition-all hover:bg-white/10 active:scale-95"
                  style={{ color: "var(--text-muted)" }}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Manual upload panel (collapsible) */}
      {showUpload && (
        <ManualUploadPanel onUploaded={() => { loadAlerts(); setShowUpload(false) }} />
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-px border-b shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--border)" }}>
        {[
          { label: "Total",          value: alerts.length,  color: "var(--text)" },
          { label: "Alerts Sent",    value: sentCount,      color: "#f87171"      },
          { label: "Pending Review", value: pendingReview,  color: "#fbbf24"      },
        ].map(s => (
          <div key={s.label} className="flex flex-col items-center justify-center py-2.5 gap-0.5"
               style={{ background: "var(--surface)" }}>
            <span className="text-base font-bold tabular-nums" style={{ color: s.color }}>{s.value}</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-2 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        {(["all", "sent", "suppressed"] as const).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
                  className="rounded-md px-2.5 py-1 text-[10px] font-medium capitalize transition-all"
                  style={{
                    color:      filter === f ? "#fff" : "var(--text-muted)",
                    background: filter === f ? "rgba(59,130,246,0.15)" : "transparent",
                    border:     `1px solid ${filter === f ? "rgba(59,130,246,0.3)" : "transparent"}`,
                  }}>
            {f === "all"
              ? `All (${alerts.length})`
              : f === "sent"
              ? `Sent (${sentCount})`
              : `Suppressed (${suppressedCount})`}
          </button>
        ))}
      </div>

      {/* Incident list */}
      <div className="flex-1 overflow-y-auto">
        {loading && alerts.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Loading incidents…</span>
          </div>
        ) : visibleAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <XCircle className="h-5 w-5" style={{ color: "var(--text-muted)" }} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>No incidents found</span>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {visibleAlerts.map(alert => {
              const human  = statusMap[alert.id] ?? "pending"
              const pinged = alert.status === "sent" && alert.contacts_notified.length > 0

              return (
                <div key={alert.id}
                     className="group flex flex-col gap-2.5 px-4 py-3 transition-colors hover:bg-white/[0.02]">

                  {/* Row 1: filename + time + dismiss */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate"
                          style={{ color: "var(--text)", maxWidth: 220 }}>
                      {alert.filename ?? "Manual submission"}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {formatTime(alert.triggered_at)}
                      </span>
                      {/* Dismiss row */}
                      <button
                        type="button"
                        onClick={() => setDismissed(prev => new Set([...prev, alert.id]))}
                        className="opacity-0 group-hover:opacity-100 rounded p-0.5 transition-all hover:bg-white/10"
                        style={{ color: "var(--text-muted)" }}
                        title="Remove from view"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Row 2: severity + bar */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold shrink-0 w-28 truncate"
                          style={{ color: alert.severity_label === "High Severity" ? "#f87171" : "#9ca3af" }}>
                      {alert.severity_label}
                    </span>
                    <SeverityBar confidence={alert.confidence} label={alert.severity_label} />
                  </div>

                  {/* Row 3: pinged + human status */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className={`h-1.5 w-1.5 rounded-full ${pinged ? "bg-emerald-500" : "bg-gray-600"}`} />
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {pinged
                          ? `${alert.contacts_notified.length} manager(s) pinged`
                          : alert.status === "suppressed"
                          ? `Below threshold (${Math.round(alert.threshold_used * 100)}%)`
                          : "Not pinged"}
                      </span>
                    </div>

                    <select
                      value={human}
                      onChange={e => setHumanStatus(alert.id, e.target.value as HumanStatus)}
                      className="rounded-md border px-2 py-0.5 text-[10px] transition-all"
                      style={{
                        background:  "var(--card)",
                        borderColor: "var(--border)",
                        color:       STATUS_COLORS[human],
                      }}
                    >
                      <option value="pending">⏳ Awaiting review</option>
                      <option value="reviewed">✓ Reviewed</option>
                      <option value="escalated">⚠ Escalated</option>
                      <option value="resolved">✔ Resolved</option>
                    </select>
                  </div>

                  {/* Incident preview */}
                  {alert.incident_text && (
                    <p className="text-[10px] leading-relaxed line-clamp-2"
                       style={{ color: "var(--text-muted)" }}>
                      {alert.incident_text.slice(0, 200)}
                      {alert.incident_text.length > 200 ? "…" : ""}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

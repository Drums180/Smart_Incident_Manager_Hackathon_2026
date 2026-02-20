"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Trash2, Bell, BellOff, Loader2, Check, X } from "lucide-react"
import {
  listAlerts, listContacts, createContact, deleteContact,
  testAlert, getAlertSettings, updateAlertSettings,
} from "@/lib/api"
import type { AlertLog, AlertContact, ContactRole } from "@/lib/types"

const ROLE_OPTIONS: ContactRole[] = ["Manager", "VP Safety", "Director", "EHS Lead"]
const ROLE_COLORS: Record<string, string> = {
  "Manager":   "rgba(59,130,246,0.15)", "VP Safety": "rgba(239,68,68,0.15)",
  "Director":  "rgba(168,85,247,0.15)", "EHS Lead":  "rgba(34,197,94,0.15)",
}
const ROLE_TEXT: Record<string, string> = {
  "Manager":   "#60a5fa", "VP Safety": "#f87171",
  "Director":  "#c084fc", "EHS Lead":  "#4ade80",
}

function formatRelTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string; label: string }> = {
    sent:       { bg: "rgba(34,197,94,0.12)",   color: "#4ade80", label: "Sent" },
    failed:     { bg: "rgba(239,68,68,0.12)",   color: "#f87171", label: "Failed" },
    suppressed: { bg: "rgba(107,114,128,0.15)", color: "#9ca3af", label: "Suppressed" },
    pending:    { bg: "rgba(251,191,36,0.12)",  color: "#fbbf24", label: "Pending" },
  }
  const c = cfg[status] ?? cfg.pending
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ background: c.bg, color: c.color }}>{c.label}</span>
  )
}

export default function AlertDashboard() {
  const [alerts,     setAlerts]     = useState<AlertLog[]>([])
  const [contacts,   setContacts]   = useState<AlertContact[]>([])
  const [threshold,  setThreshold]  = useState(0.75)
  const [showAdd,    setShowAdd]    = useState(false)
  const [isTesting,  setIsTesting]  = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [isSaving,   setIsSaving]   = useState(false)
  // Locally dismissed alert IDs (cleared on reload — no backend delete needed for demo)
  const [dismissed,  setDismissed]  = useState<Set<string>>(new Set())
  const [newContact, setNewContact] = useState({
    name: "", email: "", role: "Manager" as ContactRole, phone: "",
  })

  const recentAlert = alerts.find(a => {
    const diff = Date.now() - new Date(a.triggered_at).getTime()
    return diff < 3600000 && a.status === "sent"
  })

  const loadData = useCallback(async () => {
    try {
      const [a, c, s] = await Promise.all([listAlerts(), listContacts(), getAlertSettings()])
      setAlerts(a)
      setContacts(c)
      setThreshold(s.threshold)
    } catch {}
  }, [])

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 10000)
    return () => clearInterval(id)
  }, [loadData])

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await testAlert()
      setTestResult(res.triggered
        ? `✓ Alert fired — notified ${res.contacts_notified} contact(s)`
        : "Suppressed (threshold not met)")
      loadData()
    } catch { setTestResult("Failed to send test alert") }
    finally  { setIsTesting(false) }
  }

  const handleSaveContact = async () => {
    if (!newContact.name.trim() || !newContact.email.trim()) return
    setIsSaving(true)
    try {
      await createContact({ name: newContact.name, email: newContact.email,
                            role: newContact.role, phone: newContact.phone || undefined })
      setNewContact({ name: "", email: "", role: "Manager", phone: "" })
      setShowAdd(false)
      loadData()
    } catch {} finally { setIsSaving(false) }
  }

  const handleDeleteContact = async (id: string) => {
    try { await deleteContact(id); loadData() } catch {}
  }

  const handleThresholdRelease = async () => {
    try { await updateAlertSettings(threshold) } catch {}
  }

  const visibleAlerts = alerts.filter(a => !dismissed.has(a.id)).slice(0, 8)

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--surface)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0"
           style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${recentAlert ? "bg-red-500 animate-pulse" : "bg-emerald-500"}`} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Alert System
          </span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {alerts.filter(a => a.status === "sent").length} alerts sent
        </span>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col">

        {/* ── Live Feed ─────────────────────────────────────────────────── */}
        <section className="px-4 pt-4 pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2"
             style={{ color: "var(--text-muted)" }}>Live Feed</p>

          {visibleAlerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-3"
                 style={{ borderColor: "var(--border)" }}>
              <BellOff className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>No alerts in feed</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visibleAlerts.map(alert => (
                <div key={alert.id}
                     className="group rounded-lg border p-3 flex flex-col gap-1.5 relative"
                     style={{ background: "var(--card)", borderColor: "var(--border)" }}>

                  {/* Dismiss button */}
                  <button
                    type="button"
                    onClick={() => setDismissed(prev => new Set([...prev, alert.id]))}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 rounded p-0.5 transition-all hover:bg-white/10"
                    style={{ color: "var(--text-muted)" }}
                    title="Dismiss from feed"
                  >
                    <X className="h-3 w-3" />
                  </button>

                  <div className="flex items-center justify-between gap-2 pr-5">
                    <span className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                      {alert.filename ?? "Manual submission"}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusPill status={alert.status} />
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {formatRelTime(alert.triggered_at)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold shrink-0"
                          style={{ color: alert.confidence >= 0.8 ? "#f87171" : "#fbbf24" }}>
                      {alert.severity_label}
                    </span>
                    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                      <div className="h-full rounded-full"
                           style={{ width: `${Math.round(alert.confidence * 100)}%`,
                                    background: alert.confidence >= 0.8 ? "#ef4444" : "#f59e0b" }} />
                    </div>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
                      {Math.round(alert.confidence * 100)}%
                    </span>
                  </div>

                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {alert.contacts_notified.length} contact(s) notified
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="h-px mx-4" style={{ background: "var(--border)" }} />

        {/* ── Contacts ──────────────────────────────────────────────────── */}
        <section className="px-4 pt-3 pb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider"
               style={{ color: "var(--text-muted)" }}>Notify on Alert</p>
            <button type="button" onClick={() => setShowAdd(v => !v)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all hover:bg-white/10 active:scale-95"
                    style={{ color: "var(--accent)", border: "1px solid rgba(59,130,246,0.3)" }}>
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>

          {showAdd && (
            <div className="flex flex-col gap-2 rounded-lg border p-3 mb-2"
                 style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "name",  ph: "Name" },
                  { key: "email", ph: "Email" },
                ].map(f => (
                  <input key={f.key} placeholder={f.ph}
                         value={(newContact as any)[f.key]}
                         onChange={e => setNewContact(p => ({ ...p, [f.key]: e.target.value }))}
                         className="rounded-md border px-2.5 py-1.5 text-xs"
                         style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={newContact.role}
                        onChange={e => setNewContact(p => ({ ...p, role: e.target.value as ContactRole }))}
                        className="rounded-md border px-2.5 py-1.5 text-xs"
                        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <input placeholder="Phone (optional)" value={newContact.phone}
                       onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))}
                       className="rounded-md border px-2.5 py-1.5 text-xs"
                       style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} />
              </div>
              <button type="button" onClick={handleSaveContact} disabled={isSaving}
                      className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ background: "var(--accent)", color: "#fff" }}>
                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save Contact
              </button>
            </div>
          )}

          {contacts.length === 0 ? (
            <p className="text-xs py-2" style={{ color: "var(--text-muted)" }}>
              No contacts added yet — alerts will be logged but not emailed.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {contacts.map(c => (
                <div key={c.id}
                     className="group flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                     style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>{c.name}</span>
                    <span className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{c.email}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{ background: ROLE_COLORS[c.role] ?? "rgba(107,114,128,0.15)",
                                   color: ROLE_TEXT[c.role] ?? "#9ca3af" }}>
                      {c.role}
                    </span>
                    <button type="button" onClick={() => handleDeleteContact(c.id)}
                            className="opacity-0 group-hover:opacity-100 rounded p-0.5 transition-all hover:text-red-400"
                            style={{ color: "var(--text-muted)" }}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="h-px mx-4" style={{ background: "var(--border)" }} />

        {/* ── Alert Settings ────────────────────────────────────────────── */}
        <section className="px-4 pt-3 pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-3"
             style={{ color: "var(--text-muted)" }}>Alert Settings</p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--text)" }}>Confidence threshold</span>
                <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                  {Math.round(threshold * 100)}%
                </span>
              </div>
              <input type="range" min={50} max={95} step={5}
                     value={Math.round(threshold * 100)}
                     onChange={e => setThreshold(Number(e.target.value) / 100)}
                     onMouseUp={handleThresholdRelease}
                     onTouchEnd={handleThresholdRelease}
                     className="w-full" />
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Alerts fire when High Severity confidence ≥ {Math.round(threshold * 100)}%
              </p>
            </div>

            <button type="button" onClick={handleTest} disabled={isTesting}
                    className="flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-medium transition-all hover:bg-white/8 active:scale-[0.97] disabled:opacity-50"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              {isTesting
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                : <><Bell className="h-3.5 w-3.5" /> Send Test Alert</>}
            </button>

            {testResult && (
              <p className="text-[10px] text-center"
                 style={{ color: testResult.startsWith("✓") ? "#4ade80" : "#f87171" }}>
                {testResult}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

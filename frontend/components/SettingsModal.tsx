"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { X, Eye, EyeOff, Loader2, Check, AlertCircle } from "lucide-react"
import { useSettingsStore, useChatStore } from "@/lib/store"
import {
  validateApiKey,
  getModels,
  getStatus,
  uploadDataset,
  analyzePdfSeverity,
} from "@/lib/api"
import type { StatusResponse, SeverityResult } from "@/lib/types"
import SeverityBadge from "@/components/SeverityBadge"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

type TestStatus = null | "testing" | { valid: true } | { valid: false; error: string }

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    provider, api_key, model, n_results,
    setProvider, setApiKey, setModel, setNResults,
  } = useSettingsStore()

  const { isRebuilding, setRebuilding } = useChatStore()

  const [showApiKey,    setShowApiKey]    = useState(false)
  const [testStatus,    setTestStatus]    = useState<TestStatus>(null)
  const [models,        setModels]        = useState<Record<string, { id: string; label: string }[]>>({})
  const [statusData,    setStatusData]    = useState<StatusResponse | null>(null)
  const [selectedFile,  setSelectedFile]  = useState<File | null>(null)
  const [isPolling,     setIsPolling]     = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // PDF state
  const [selectedPdfFile,   setSelectedPdfFile]   = useState<File | null>(null)
  const [pdfSeverityResult, setPdfSeverityResult] = useState<SeverityResult | null>(null)
  const [isAnalyzingPdf,    setIsAnalyzingPdf]    = useState(false)
  const [pdfError,          setPdfError]          = useState<string | null>(null)
  const [pdfWordCount,      setPdfWordCount]      = useState<number | null>(null)
  const [pdfWhatHappened,   setPdfWhatHappened]   = useState<string | null>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark"
    const saved = localStorage.getItem("theme")
    if (saved === "light" || saved === "dark") return saved
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  useEffect(() => {
    if (!open) return
    getModels().then(setModels).catch(() => {})
    getStatus().then(setStatusData).catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open || !isPolling) return
    const id = setInterval(async () => {
      try {
        const s = await getStatus()
        setStatusData(s)
        setRebuilding(s.rebuilding)
        if (!s.rebuilding) setIsPolling(false)
      } catch {
        setIsPolling(false)
      }
    }, 3000)
    return () => clearInterval(id)
  }, [open, isPolling, setRebuilding])

  useEffect(() => { setTestStatus(null) }, [api_key, provider])

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", theme === "dark")
      try { localStorage.setItem("theme", theme) } catch {}
    }
  }, [theme])

  const handleTestConnection = async () => {
    setTestStatus("testing")
    try {
      const res = await validateApiKey(provider, api_key)
      setTestStatus(res.valid ? { valid: true } : { valid: false, error: res.error ?? "Invalid key" })
    } catch (e) {
      setTestStatus({ valid: false, error: String(e) })
    }
  }

  const handleRebuildIndex = useCallback(async () => {
    if (!selectedFile || isRebuilding || isPolling) return
    try {
      await uploadDataset(selectedFile)
      setRebuilding(true)
      setIsPolling(true)
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch {
      setIsPolling(false)
    }
  }, [selectedFile, isRebuilding, isPolling, setRebuilding])

  const handleAnalyzePdf = useCallback(async () => {
    if (!selectedPdfFile || isAnalyzingPdf) return
    setIsAnalyzingPdf(true)
    setPdfError(null)
    setPdfSeverityResult(null)
    setPdfWordCount(null)
    setPdfWhatHappened(null)
    try {
      const result = await analyzePdfSeverity(selectedPdfFile)
      setPdfSeverityResult(result.severity)
      setPdfWordCount(result.word_count)
      setPdfWhatHappened(result.what_happened)
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Failed to analyze PDF")
    } finally {
      setIsAnalyzingPdf(false)
    }
  }, [selectedPdfFile, isAnalyzingPdf])

  const rag = statusData?.rag
  const statusLine = rag
    ? `${rag.records} records · ${rag.chunks} chunks · ${rag.years[0] ?? "?"}–${rag.years[rag.years.length - 1] ?? "?"}`
    : "Loading…"

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />

      {/* Panel */}
      <div
        className="absolute right-0 top-0 bottom-0 flex w-[400px] flex-col gap-6 overflow-y-auto p-6"
        style={{ background: "var(--card)", borderLeft: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors duration-150 hover:bg-white/10 active:bg-white/15 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Theme */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            Theme
          </label>
          <div className="flex gap-2">
            {(["light", "dark"] as const).map((t) => {
              const active = theme === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className="flex-1 rounded-lg px-3 py-2 text-sm transition-all duration-150 cursor-pointer"
                  style={
                    active
                      ? { borderColor: "var(--accent)", background: "var(--accent)", color: "var(--accent-foreground)" }
                      : { borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }
                  }
                >
                  {t === "light" ? "Light" : "Dark"}
                </button>
              )
            })}
          </div>
        </div>

        {/* AI Provider */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            AI Provider
          </label>
          <div className="flex gap-2">
            {(["groq", "anthropic"] as const).map((p) => {
              const active = provider === p
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border px-3 py-2 text-sm transition-all duration-150 cursor-pointer hover:brightness-110 active:scale-[0.98]"
                  style={
                    active
                      ? { borderColor: "var(--accent)", background: "var(--accent)", color: "var(--accent-foreground)" }
                      : { borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }
                  }
                >
                  <span className="font-medium">{p === "groq" ? "Groq" : "Anthropic"}</span>
                  <span className="text-xs opacity-75">
                    {p === "groq" ? "Free · Fast · Llama 3.3 70B" : "Paid · Best quality · Claude"}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* API Key */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            API Key
          </label>
          <div className="relative">
            <input
              type={showApiKey ? "text" : "password"}
              value={api_key}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Your API key"
              className="w-full rounded-lg border px-3 py-2 pr-9 text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border)",
                color: "var(--text)",
              }}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-white/10 cursor-pointer"
              style={{ color: "var(--text-muted)" }}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testStatus === "testing" || !api_key.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-150 hover:bg-white/10 active:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {testStatus === "testing" && (
              <><Loader2 className="h-4 w-4 animate-spin" /> Testing…</>
            )}
            {testStatus && testStatus !== "testing" && (testStatus as { valid: boolean }).valid && (
              <><Check className="h-4 w-4 text-green-400" /> Connected</>
            )}
            {testStatus && testStatus !== "testing" && !(testStatus as { valid: boolean }).valid && (
              <>
                <AlertCircle className="h-4 w-4 text-red-400" />
                <span className="truncate max-w-[260px]">
                  {((testStatus as { valid: false; error: string }).error ?? "").slice(0, 60)}
                </span>
              </>
            )}
            {!testStatus && "Test Connection"}
          </button>
        </div>

        {/* Model */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            Model
          </label>
          <select
            value={model ?? ""}
            onChange={(e) => setModel(e.target.value || null)}
            className="w-full rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors hover:border-[var(--accent)] focus:outline-none focus:border-[var(--accent)]"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
          >
            <option value="">Use provider default</option>
            {(models[provider] ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Retrieval depth */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            Sources per query
          </label>
          <input
            type="range"
            min={4} max={16} step={2}
            value={n_results}
            onChange={(e) => setNResults(Number(e.target.value))}
            className="w-full cursor-pointer accent-blue-500"
          />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Retrieving {n_results} sources
          </p>
        </div>

        {/* Dataset management */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            Dataset Management
          </label>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{statusLine}</p>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm transition-all duration-150 hover:border-[var(--accent)] hover:bg-white/5"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
            {selectedFile ? (
              <span style={{ color: "var(--text)" }}>
                {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </span>
            ) : (
              "Drop CSV here or click to browse"
            )}
          </div>

          <button
            type="button"
            onClick={handleRebuildIndex}
            disabled={!selectedFile || isRebuilding || isPolling}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            style={{ background: "var(--accent)" }}
          >
            {(isRebuilding || isPolling) && <Loader2 className="h-4 w-4 animate-spin" />}
            {(isRebuilding || isPolling) ? "Rebuilding index…" : "Rebuild Index"}
          </button>

          {!isRebuilding && !isPolling && statusData && (
            <p className="flex items-center gap-1 text-xs text-green-400">
              <Check className="h-3 w-3" />
              Done — {statusData.rag?.chunks ?? 0} chunks indexed
            </p>
          )}
        </div>

        {/* PDF Severity Analysis */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            PDF Severity Analysis
          </label>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Upload a PDF report to analyze the severity of the "What happened" section
          </p>

          <div
            role="button"
            tabIndex={0}
            onClick={() => pdfInputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && pdfInputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm transition-all duration-150 hover:border-[var(--accent)] hover:bg-white/5"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setSelectedPdfFile(f)
                setPdfSeverityResult(null)
                setPdfError(null)
                setPdfWordCount(null)
                setPdfWhatHappened(null)
              }}
            />
            {selectedPdfFile ? (
              <span style={{ color: "var(--text)" }}>
                {selectedPdfFile.name} ({(selectedPdfFile.size / 1024).toFixed(1)} KB)
              </span>
            ) : (
              "Drop PDF here or click to browse"
            )}
          </div>

          <button
            type="button"
            onClick={handleAnalyzePdf}
            disabled={!selectedPdfFile || isAnalyzingPdf}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            style={{ background: "var(--accent)" }}
          >
            {isAnalyzingPdf && <Loader2 className="h-4 w-4 animate-spin" />}
            {isAnalyzingPdf ? "Analyzing…" : "Analyze Severity"}
          </button>

          {pdfError && (
            <p className="flex items-start gap-1 text-xs text-red-400">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {pdfError}
            </p>
          )}

          {pdfSeverityResult && (
            <div
              className="flex flex-col gap-2 rounded-lg border p-3"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              {pdfSeverityResult.available ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Predicted severity:
                    </span>
                    <SeverityBadge severity={pdfSeverityResult} />
                  </div>
                  {pdfWordCount !== null && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {pdfWordCount} words extracted · {selectedPdfFile?.name}
                    </p>
                  )}
                  {pdfWhatHappened && (
                    <details>
                      <summary
                        className="cursor-pointer text-xs transition-colors hover:text-white"
                        style={{ color: "var(--text-muted)" }}
                      >
                        "What Happened" section detected
                      </summary>
                      <p
                        className="mt-1 text-xs leading-relaxed"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {pdfWhatHappened.slice(0, 300)}
                        {pdfWhatHappened.length > 300 ? "…" : ""}
                      </p>
                    </details>
                  )}
                </>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Text extracted ({pdfWordCount} words) but severity model is not loaded.{" "}
                  Drop <code className="font-mono text-[10px]">severity_model.pkl</code> into{" "}
                  <code className="font-mono text-[10px]">backend/models/</code> to enable predictions.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Keys are stored in your browser only. Never sent to any server except the AI provider.
        </p>
      </div>
    </div>
  )
}

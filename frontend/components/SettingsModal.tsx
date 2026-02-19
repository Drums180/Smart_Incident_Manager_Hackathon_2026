"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { X, Eye, EyeOff, Loader2, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSettingsStore, useChatStore } from "@/lib/store"
import {
  validateApiKey,
  getModels,
  getStatus,
  uploadDataset,
} from "@/lib/api"
import type { StatusResponse } from "@/lib/types"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

type TestStatus = null | "testing" | { valid: true } | { valid: false; error: string }

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    provider,
    api_key,
    model,
    n_results,
    setProvider,
    setApiKey,
    setModel,
    setNResults,
  } = useSettingsStore()

  const { isRebuilding, setRebuilding } = useChatStore()

  const [showApiKey, setShowApiKey] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>(null)
  const [models, setModels] = useState<Record<string, { id: string; label: string }[]>>({})
  const [statusData, setStatusData] = useState<StatusResponse | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch models and status when modal opens
  useEffect(() => {
    if (!open) return
    getModels().then(setModels).catch(() => {})
    getStatus().then(setStatusData).catch(() => {})
  }, [open])

  // Poll status when rebuilding
  useEffect(() => {
    if (!open || !isPolling) return
    const id = setInterval(async () => {
      try {
        const status = await getStatus()
        setStatusData(status)
        setRebuilding(status.rebuilding)
        if (!status.rebuilding) setIsPolling(false)
      } catch {
        setIsPolling(false)
      }
    }, 3000)
    return () => clearInterval(id)
  }, [open, isPolling, setRebuilding])

  // Clear test result when api_key or provider changes
  useEffect(() => {
    setTestStatus(null)
  }, [api_key, provider])

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

  const rag = statusData?.rag
  const statusLine = rag
    ? `${rag.records} records · ${rag.chunks} chunks · ${rag.years[0] ?? "?"}–${rag.years[rag.years.length - 1] ?? "?"}`
    : "Loading…"

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        className="absolute right-0 top-0 bottom-0 flex w-[400px] flex-col gap-6 overflow-y-auto p-6"
        style={{
          background: "var(--card)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        {/* 1. Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            Settings
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 2. AI Provider */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            AI Provider
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setProvider("groq")}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border px-3 py-2 text-sm transition-colors"
              style={
                provider === "groq"
                  ? { borderColor: "var(--accent)", background: "rgba(59, 130, 246, 0.1)", color: "var(--accent)" }
                  : { borderColor: "var(--border)", color: "var(--text-muted)" }
              }
            >
              Groq
              <span className="text-xs opacity-80">Free · Fast · Llama 3.3 70B</span>
            </button>
            <button
              type="button"
              onClick={() => setProvider("anthropic")}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border px-3 py-2 text-sm transition-colors"
              style={
                provider === "anthropic"
                  ? { borderColor: "var(--accent)", background: "rgba(59, 130, 246, 0.1)", color: "var(--accent)" }
                  : { borderColor: "var(--border)", color: "var(--text-muted)" }
              }
            >
              Anthropic
              <span className="text-xs opacity-80">Paid · Best quality · Claude</span>
            </button>
          </div>
        </div>

        {/* 3. API Key */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            API Key
          </label>
          <div className="relative">
            <Input
              type={showApiKey ? "text" : "password"}
              value={api_key}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-9"
              placeholder="Your API key"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestConnection}
            disabled={testStatus === "testing" || !api_key.trim()}
            className="w-full justify-center gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            {testStatus === "testing" && <Loader2 className="h-4 w-4 animate-spin" />}
            {testStatus === "testing" && "Testing..."}
            {testStatus && testStatus !== "testing" && testStatus.valid && (
              <>
                <Check className="h-4 w-4 text-green-500" /> Connected
              </>
            )}
            {testStatus && testStatus !== "testing" && !testStatus.valid && (
              <>
                <AlertCircle className="h-4 w-4 text-red-500" />
                {(testStatus.error ?? "").slice(0, 60)}
                {(testStatus.error?.length ?? 0) > 60 ? "…" : ""}
              </>
            )}
            {!testStatus && "Test Connection"}
          </Button>
        </div>

        {/* 4. Model */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            Model
          </label>
          <select
            value={model ?? ""}
            onChange={(e) => setModel(e.target.value || null)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
          >
            <option value="">Use provider default</option>
            {(models[provider] ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* 5. Retrieval depth */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            Sources per query
          </label>
          <input
            type="range"
            min={4}
            max={16}
            step={2}
            value={n_results}
            onChange={(e) => setNResults(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Retrieving {n_results} sources
          </p>
        </div>

        {/* 6. Dataset */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            Dataset Management
          </label>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {statusLine}
          </p>
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            onClick={() => fileInputRef.current?.click()}
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
          <Button
            onClick={handleRebuildIndex}
            disabled={!selectedFile || isRebuilding || isPolling}
            className="w-full justify-center gap-2"
            style={{ background: "var(--accent)" }}
          >
            {(isRebuilding || isPolling) && <Loader2 className="h-4 w-4 animate-spin" />}
            {(isRebuilding || isPolling) ? "Rebuilding index..." : "Rebuild Index"}
          </Button>
          {!isRebuilding && !isPolling && statusData && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Done — {statusData.rag?.chunks ?? 0} chunks indexed
            </p>
          )}
        </div>

        {/* 7. Footer */}
        <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Keys are stored in your browser only. Never sent to any server except the AI provider.
        </p>
      </div>
    </div>
  )
}

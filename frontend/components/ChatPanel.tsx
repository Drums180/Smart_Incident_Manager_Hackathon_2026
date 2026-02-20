"use client"

import {
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react"
import { Send, Plus, Trash2, FileText, X, Loader2 } from "lucide-react"
import { useChatStore, useSettingsStore } from "@/lib/store"
import {
  sendMessage as apiSendMessage,
  listConversations,
  getConversation,
  deleteConversation,
  analyzePdfSeverity,
} from "@/lib/api"
import MessageBubble from "@/components/MessageBubble"
import WelcomeScreen from "@/components/WelcomeScreen"
import SeverityBadge from "@/components/SeverityBadge"
import type { SeverityResult } from "@/lib/types"

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return "Yesterday"
  return date.toLocaleDateString()
}

// ── Severity Analysis Panel ────────────────────────────────────────────────────

interface PdfPanelProps {
  onClose: () => void
  onSendToChat: (message: string, severity: SeverityResult | null) => void
  onPrefillPrompt: (text: string) => void
}

function PdfPanel({ onClose, onSendToChat, onPrefillPrompt }: PdfPanelProps) {
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<SeverityResult | null>(null)
  const [wordCount, setWordCount] = useState<number | null>(null)
  const [whatHappened, setWhatHappened] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are accepted.")
      return
    }
    setSelectedFile(file)
    setResult(null)
    setError(null)
    setWhatHappened(null)
    setWordCount(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleAnalyze = useCallback(async () => {
    if (!selectedFile || isAnalyzing) return
    setIsAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      const res = await analyzePdfSeverity(selectedFile)
      setResult(res.severity)
      setWordCount(res.word_count ?? null)
      setWhatHappened(res.what_happened ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze PDF")
    } finally {
      setIsAnalyzing(false)
    }
  }, [selectedFile, isAnalyzing])

  const handleRecommendation = () => {
    const context = whatHappened
      ? `Based on this incident report (${selectedFile?.name}, predicted severity: ${result?.label}, confidence: ${Math.round((result?.confidence ?? 0) * 100)}%):\n\n"${whatHappened.slice(0, 600)}${whatHappened.length > 600 ? "…" : ""}"\n\nWhat are your recommendations to prevent this type of incident from happening again? Include both immediate corrective actions and long-term systemic improvements.`
      : `Based on this incident report (${selectedFile?.name}, predicted severity: ${result?.label}), what are your recommendations to prevent this type of incident from happening again?`
    onSendToChat(context, result)  // pass PDF severity so the chat badge matches
    onClose()
  }

  const handleAddPrompt = () => {
    const prefix = whatHappened
      ? `Regarding the incident report "${selectedFile?.name}" (severity: ${result?.label}): `
      : `Regarding "${selectedFile?.name}": `
    onPrefillPrompt(prefix)
    onClose()
  }

  const hasResult = result !== null

  return (
    <div
      className="mx-3 mb-2 rounded-xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
            Severity Analysis
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 transition-all hover:bg-white/10 active:scale-95"
          style={{ color: "var(--text-muted)" }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => pdfInputRef.current?.click()}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 transition-all hover:border-[var(--accent)] hover:bg-[rgba(59,130,246,0.04)]"
          style={{
            borderColor: isDragging ? "var(--accent)" : selectedFile ? "rgba(59,130,246,0.4)" : "var(--border)",
            background: isDragging ? "rgba(59,130,246,0.06)" : "var(--surface)",
          }}
        >
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: selectedFile ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.04)" }}
          >
            <FileText
              className="h-4 w-4"
              style={{ color: selectedFile ? "var(--accent)" : "var(--text-muted)" }}
            />
          </div>
          <div className="flex min-w-0 flex-col">
            {selectedFile ? (
              <>
                <span className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                  {selectedFile.name}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {(selectedFile.size / 1024).toFixed(1)} KB · click to replace
                </span>
              </>
            ) : (
              <>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  Drop PDF or click to browse
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Incident reports, safety PDFs
                </span>
              </>
            )}
          </div>
        </div>

        {/* Analyze button */}
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={!selectedFile || isAnalyzing}
          className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-semibold tracking-wide transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ background: "var(--accent)", color: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
        >
          {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isAnalyzing ? "Analyzing…" : "Run Analysis"}
        </button>

        {/* Error */}
        {error && (
          <p className="rounded-lg px-3 py-2 text-xs text-red-400" style={{ background: "rgba(239,68,68,0.08)" }}>
            {error}
          </p>
        )}

        {/* ── Result card ── */}
        {hasResult && (
          <div
            className="flex flex-col gap-3 rounded-lg border p-3"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            {/* Severity + meta */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Predicted severity
                </span>
                <SeverityBadge severity={result!} />
              </div>
              {wordCount !== null && (
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {wordCount} words · {selectedFile?.name}
                </p>
              )}
            </div>

            {/* What happened preview */}
            {whatHappened && (
              <p
                className="text-[10px] leading-relaxed line-clamp-3"
                style={{ color: "var(--text-muted)" }}
              >
                {whatHappened}
              </p>
            )}

            {/* Divider */}
            <div className="h-px w-full" style={{ background: "var(--border)" }} />

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddPrompt}
                className="flex flex-1 items-center justify-center rounded-lg border py-2 text-xs font-medium transition-all hover:bg-white/8 hover:border-white/20 active:scale-[0.97] active:bg-white/12"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text)",
                  background: "transparent",
                }}
              >
                Add Your Own Prompt
              </button>
              <button
                type="button"
                onClick={handleRecommendation}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all hover:brightness-110 active:scale-[0.97]"
                style={{
                  background: "var(--accent)",
                  color: "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                }}
              >
                Ask for Recommendation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
// MAIN CHAT PANEL
// ══════════════════════════════════════════════════════════════════════════════

export default function ChatPanel() {
  const [inputValue, setInputValue] = useState("")
  const [showPdfPanel, setShowPdfPanel] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const {
    activeConversationId,
    conversations,
    messages,
    isLoading,
    setActiveConversationId,
    setConversations,
    setMessages,
    addOptimisticUserMessage,
    addLoadingPlaceholder,
    resolveAssistantMessage,
    setLoading,
  } = useChatStore()

  const activeConversation = conversations.find((c) => c.id === activeConversationId)

  useEffect(() => {
    listConversations().then(setConversations).catch(() => {})
  }, [setConversations])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null)
    setMessages([])
  }, [setActiveConversationId, setMessages])

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversationId(id)
      getConversation(id)
        .then((conv) => setMessages(conv.messages))
        .catch(() => setMessages([]))
    },
    [setActiveConversationId, setMessages]
  )

  const handleDeleteConversation = useCallback(
    (id: string) => {
      deleteConversation(id).catch(() => {})
      if (id === activeConversationId) handleNewChat()
      listConversations().then(setConversations).catch(() => {})
    },
    [activeConversationId, handleNewChat, setConversations]
  )

  const handleSendMessage = useCallback(
    (text?: string, overrideSeverity?: SeverityResult | null) => {
      const message = (text ?? inputValue).trim()
      if (!message) return

      setInputValue("")
      if (textareaRef.current) textareaRef.current.style.height = "auto"
      setLoading(true)

      addOptimisticUserMessage(message)
      const placeholderId = addLoadingPlaceholder()

      const store = useChatStore.getState()
      const settings = useSettingsStore.getState()

      apiSendMessage({
        message,
        conversation_id: store.activeConversationId,
        provider: settings.provider,
        api_key: settings.api_key,
        model: settings.model ?? undefined,
        n_results: settings.n_results,
      })
        .then((res) => {
          if (res.is_new_conversation) {
            useChatStore.getState().setActiveConversationId(res.conversation_id)
            listConversations().then((convs) =>
              useChatStore.getState().setConversations(convs)
            )
          }
          // Use the pre-computed PDF severity if provided — don't re-infer on message text
          const severityToShow = overrideSeverity !== undefined ? overrideSeverity : res.severity
          resolveAssistantMessage(placeholderId, res.answer, res.sources, severityToShow)
        })
        .catch(() => {
          resolveAssistantMessage(
            placeholderId,
            "Sorry, something went wrong. Check Settings and try again.",
            [],
            null
          )
        })
        .finally(() => {
          setLoading(false)
          textareaRef.current?.focus()
        })
    },
    [inputValue, setLoading, addOptimisticUserMessage, addLoadingPlaceholder, resolveAssistantMessage]
  )

  const handleTextareaInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSendMessage()
      }
    },
    [handleSendMessage]
  )

  return (
    <div className="flex h-full flex-row overflow-hidden">
      {/* Sidebar */}
      <div
        className="flex w-[240px] shrink-0 flex-col overflow-hidden border-r"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            Conversations
          </span>
          <button
            type="button"
            onClick={handleNewChat}
            className="rounded p-1 transition-colors hover:bg-white/10"
            style={{ color: "var(--text-muted)" }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="p-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              No conversations yet.<br />Start chatting!
            </p>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectConversation(conv.id)}
                onKeyDown={(e) => e.key === "Enter" && handleSelectConversation(conv.id)}
                className="group flex cursor-pointer items-start justify-between gap-2 px-3 py-2.5 transition-colors hover:bg-white/5"
                style={
                  conv.id === activeConversationId
                    ? { borderLeft: "2px solid var(--accent)", background: "#1a2030" }
                    : undefined
                }
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-xs" style={{ color: "var(--text)", maxWidth: 160 }}>
                    {conv.title}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {formatRelativeTime(conv.updated_at)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id) }}
                  className="shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Title bar */}
        <header
          className="flex h-12 shrink-0 items-center border-b px-4"
          style={{ borderColor: "var(--border)" }}
        >
          <span
            className="text-sm"
            style={{
              color: activeConversationId ? "var(--text)" : "var(--text-muted)",
              fontWeight: activeConversationId ? 500 : undefined,
            }}
          >
            {activeConversationId
              ? activeConversation?.title ?? "Conversation"
              : "New Conversation"}
          </span>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {messages.length === 0 && !activeConversationId ? (
            <WelcomeScreen onQuestion={handleSendMessage} />
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* PDF panel — sits just above the input, slides in */}
        {showPdfPanel && (
          <PdfPanel
            onClose={() => setShowPdfPanel(false)}
            onSendToChat={(msg, severity) => handleSendMessage(msg, severity)}
            onPrefillPrompt={(text) => {
              setInputValue(text)
              setTimeout(() => textareaRef.current?.focus(), 50)
            }}
          />
        )}

        {/* Input area */}
        <div
          className="shrink-0 border-t"
          style={{ borderColor: "var(--border)" }}
        >
          {/* Toolbar */}
          <div className="flex items-center gap-1 px-3 pt-2 pb-1">
            <button
              type="button"
              onClick={() => setShowPdfPanel((v) => !v)}
              title="Analyze PDF severity"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all hover:bg-white/10 active:scale-95"
              style={{
                color: showPdfPanel ? "var(--accent)" : "var(--text-muted)",
                background: showPdfPanel ? "rgba(59,130,246,0.1)" : "transparent",
                border: `1px solid ${showPdfPanel ? "rgba(59,130,246,0.25)" : "transparent"}`,
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Severity Analysis
            </button>
          </div>

          {/* Textarea + send */}
          <div className="flex items-end gap-2 px-3 pb-3">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onInput={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about safety incidents..."
              rows={1}
              disabled={isLoading}
              className="max-h-[120px] flex-1 resize-none rounded-xl border px-3 py-2.5 text-sm transition-colors focus:outline-none disabled:opacity-50"
              style={{
                background: "var(--card)",
                borderColor: "var(--border)",
                color: "var(--text)",
              }}
            />
            <button
              type="button"
              onClick={() => handleSendMessage()}
              disabled={isLoading || !inputValue.trim()}
              className="flex shrink-0 items-center justify-center rounded-xl p-2.5 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "var(--accent)" }}
            >
              <Send className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

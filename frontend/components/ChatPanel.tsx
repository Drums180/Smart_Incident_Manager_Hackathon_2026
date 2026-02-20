"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { Send, Plus, Trash2 } from "lucide-react"
import { useChatStore, useSettingsStore } from "@/lib/store"
import {
  sendMessage as apiSendMessage,
  listConversations,
  getConversation,
  deleteConversation,
} from "@/lib/api"
import MessageBubble from "@/components/MessageBubble"
import WelcomeScreen from "@/components/WelcomeScreen"

function formatRelativeTime(isoString: string): string {
  const diffMs   = Date.now() - new Date(isoString).getTime()
  const mins     = Math.floor(diffMs / 60_000)
  const hours    = Math.floor(diffMs / 3_600_000)
  const days     = Math.floor(diffMs / 86_400_000)
  if (mins  < 1)   return "Just now"
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days === 1)  return "Yesterday"
  return new Date(isoString).toLocaleDateString()
}

export default function ChatPanel() {
  const [inputValue, setInputValue] = useState("")
  const textareaRef    = useRef<HTMLTextAreaElement>(null)
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

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id)
    getConversation(id)
      .then((conv) => setMessages(conv.messages))
      .catch(() => setMessages([]))
  }, [setActiveConversationId, setMessages])

  const handleDeleteConversation = useCallback((id: string) => {
    deleteConversation(id).catch(() => {})
    if (id === activeConversationId) handleNewChat()
    listConversations().then(setConversations).catch(() => {})
  }, [activeConversationId, handleNewChat, setConversations])

  const handleSendMessage = useCallback((text?: string) => {
    const message = (text ?? inputValue).trim()
    if (!message || isLoading) return

    setInputValue("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    setLoading(true)

    addOptimisticUserMessage(message)
    const placeholderId = addLoadingPlaceholder()

    const store    = useChatStore.getState()
    const settings = useSettingsStore.getState()

    apiSendMessage({
      message,
      conversation_id: store.activeConversationId,
      provider:        settings.provider,
      api_key:         settings.api_key,
      model:           settings.model ?? undefined,
      n_results:       settings.n_results,
    })
      .then((res) => {
        if (res.is_new_conversation) {
          useChatStore.getState().setActiveConversationId(res.conversation_id)
          listConversations().then((convs) =>
            useChatStore.getState().setConversations(convs)
          )
        }
        resolveAssistantMessage(placeholderId, res.answer, res.sources, res.severity)
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
  }, [inputValue, isLoading, setLoading, addOptimisticUserMessage,
      addLoadingPlaceholder, resolveAssistantMessage])

  const handleTextareaInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }, [handleSendMessage])

  return (
    <div className="flex h-full flex-row overflow-hidden">

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <div
        className="flex w-[240px] shrink-0 flex-col overflow-hidden border-r"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        {/* Sidebar header */}
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
            title="New conversation"
            className="rounded-lg p-1.5 transition-all duration-150 hover:bg-white/10 hover:text-blue-400 active:bg-white/15 active:scale-95 cursor-pointer"
            style={{ color: "var(--text-muted)" }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="p-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              No conversations yet.
              <br />
              Start chatting!
            </p>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeConversationId
              return (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectConversation(conv.id)}
                  onKeyDown={(e) => e.key === "Enter" && handleSelectConversation(conv.id)}
                  className="group flex cursor-pointer items-start justify-between gap-2 px-3 py-2.5 transition-colors duration-150 hover:bg-white/8"
                  style={
                    isActive
                      ? { borderLeft: "2px solid var(--accent)", background: "#1a2030" }
                      : { borderLeft: "2px solid transparent" }
                  }
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span
                      className="truncate text-xs font-medium"
                      style={{
                        color:    isActive ? "var(--text)" : "var(--text-muted)",
                        maxWidth: 155,
                      }}
                    >
                      {conv.title}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {formatRelativeTime(conv.updated_at)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id) }}
                    className="shrink-0 rounded p-1 opacity-0 transition-all duration-150 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 cursor-pointer"
                    style={{ color: "var(--text-muted)" }}
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Chat area ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Header */}
        <header
          className="flex h-12 shrink-0 items-center border-b px-4"
          style={{ borderColor: "var(--border)" }}
        >
          <span
            className="text-sm"
            style={{
              color:      activeConversationId ? "var(--text)"      : "var(--text-muted)",
              fontWeight: activeConversationId ? 500                 : undefined,
            }}
          >
            {activeConversationId
              ? (activeConversation?.title ?? "Conversation")
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

        {/* Input */}
        <div
          className="flex shrink-0 items-end gap-2 border-t p-3"
          style={{ borderColor: "var(--border)" }}
        >
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onInput={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about safety incidents..."
            rows={1}
            disabled={isLoading}
            className="max-h-[120px] flex-1 resize-none rounded-xl border px-3 py-2.5 text-sm transition-colors duration-150 disabled:opacity-50 focus:outline-none focus:border-[var(--accent)]"
            style={{
              background:  "var(--card)",
              borderColor: "var(--border)",
              color:       "var(--text)",
            }}
          />
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={isLoading || !inputValue.trim()}
            className="flex shrink-0 items-center justify-center rounded-xl p-2.5 transition-all duration-150 hover:brightness-125 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            style={{ background: "var(--accent)" }}
            aria-label="Send message"
          >
            <Send className="h-4 w-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}

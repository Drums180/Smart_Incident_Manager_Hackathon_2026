import { create } from "zustand"
import { persist } from "zustand/middleware"
import type {
  ConversationSummary,
  Message,
  Source,
  SeverityResult,
} from "./types"

// ─── Store 1: useSettingsStore (persisted) ───────────────────────────────────

type Provider = "groq" | "anthropic"

interface SettingsState {
  provider: Provider
  api_key: string
  model: string | null
  n_results: number
  setProvider: (p: Provider) => void
  setApiKey: (key: string) => void
  setModel: (m: string | null) => void
  setNResults: (n: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: "groq",
      api_key: "",
      model: null,
      n_results: 8,
      setProvider: (provider) => set({ provider }),
      setApiKey: (api_key) => set({ api_key }),
      setModel: (model) => set({ model }),
      setNResults: (n_results) => set({ n_results }),
    }),
    { name: "safety-bot-settings" }
  )
)

// ─── Store 2: useChatStore (in memory) ────────────────────────────────────────

const LOADING_PLACEHOLDER_ID = "loading-placeholder"

interface ChatState {
  activeConversationId: string | null
  conversations: ConversationSummary[]
  messages: Message[]
  isLoading: boolean
  isRebuilding: boolean
  setActiveConversationId: (id: string | null) => void
  setConversations: (convs: ConversationSummary[]) => void
  setMessages: (msgs: Message[]) => void
  addMessage: (msg: Message) => void
  addOptimisticUserMessage: (content: string) => string
  addLoadingPlaceholder: () => string
  resolveAssistantMessage: (
    placeholderId: string,
    content: string,
    sources: Source[],
    severity: SeverityResult | null
  ) => void
  setLoading: (b: boolean) => void
  setRebuilding: (b: boolean) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeConversationId: null,
  conversations: [],
  messages: [],
  isLoading: false,
  isRebuilding: false,

  setActiveConversationId: (activeConversationId) =>
    set({ activeConversationId }),

  setConversations: (conversations) => set({ conversations }),

  setMessages: (messages) => set({ messages }),

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  addOptimisticUserMessage: (content) => {
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const msg: Message = {
      id,
      conversation_id: get().activeConversationId ?? "",
      role: "user",
      content,
      sources: [],
      severity: null,
      created_at: new Date().toISOString(),
    }
    set((s) => ({ messages: [...s.messages, msg] }))
    return id
  },

  addLoadingPlaceholder: () => {
    const id = `${LOADING_PLACEHOLDER_ID}-${Date.now()}`
    const msg: Message = {
      id,
      conversation_id: get().activeConversationId ?? "",
      role: "assistant",
      content: "",
      sources: [],
      severity: null,
      created_at: new Date().toISOString(),
      isLoading: true,
    }
    set((s) => ({ messages: [...s.messages, msg] }))
    return id
  },

  resolveAssistantMessage: (placeholderId, content, sources, severity) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === placeholderId
          ? {
              ...m,
              content,
              sources,
              severity,
              isLoading: false,
            }
          : m
      ),
    }))
  },

  setLoading: (isLoading) => set({ isLoading }),
  setRebuilding: (isRebuilding) => set({ isRebuilding }),
}))

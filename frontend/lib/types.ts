export interface Source {
  record_id: string
  title: string
  severity: string
  section: string
  location: string
  year: string
  score: number
}

export interface SeverityResult {
  label: string // "Major" | "Serious" | "Potentially Significant" | "Near Miss" | "Minor" | "Unknown"
  confidence: number // 0.0–1.0
  color: string // hex color string like "#ef4444"
  scores: Record<string, number>
  available: boolean
}

export interface Message {
  id: string
  conversation_id: string
  role: "user" | "assistant"
  content: string
  sources: Source[]
  severity: SeverityResult | null
  created_at: string
  isLoading?: boolean
}

export interface ConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export interface ConversationDetail extends ConversationSummary {
  messages: Message[]
}

export interface ChatRequest {
  message: string
  conversation_id: string | null
  provider: "groq" | "anthropic"
  api_key: string
  model?: string
  n_results?: number
  filters?: Record<string, unknown> | null
}

export interface ChatResponse {
  conversation_id: string
  answer: string
  sources: Source[]
  severity: SeverityResult
  parsed_filters: Record<string, unknown>
  is_new_conversation: boolean
}

export interface IndexStats {
  status: string
  chunks: number
  records: number
  years: number[]
  severity_dist: Record<string, number>
}

export interface StatusResponse {
  rag: IndexStats
  severity: { available: boolean }
  rebuilding: boolean
}

export interface ModelOption {
  id: string
  label: string
}

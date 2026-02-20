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
  label: string
  confidence: number
  color: string
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

// ── Live Reporting / Alert System ─────────────────────────────────────────────

export type ContactRole = "Manager" | "VP Safety" | "Director" | "EHS Lead"

export interface AlertContact {
  id: string
  name: string
  email: string
  role: ContactRole
  phone: string | null
  is_active: boolean
  created_at: string
}

export type AlertStatus = "sent" | "failed" | "suppressed" | "pending"

export interface AlertLog {
  id: string
  incident_text: string
  filename: string | null
  severity_label: string
  confidence: number
  threshold_used: number
  contacts_notified: string[]
  triggered_at: string
  status: AlertStatus
}

export interface AlertSettings {
  threshold: number
}

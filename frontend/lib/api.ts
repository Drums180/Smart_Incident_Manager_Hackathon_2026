import type {
  ChatRequest,
  ChatResponse,
  ConversationSummary,
  ConversationDetail,
  ModelOption,
  StatusResponse,
} from "./types"

export const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// ── Core fetch helper ──────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!response.ok) {
    let errorBody = "Unknown error"
    try { errorBody = await response.text() } catch { /* ignore */ }
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}. ${errorBody}`
    )
  }

  return response.json()
}

// ── Multipart upload helper (NO Content-Type — browser sets boundary) ──────────

async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    body: formData,
    // deliberately no Content-Type header
  })

  if (!response.ok) {
    let errorBody = "Unknown error"
    try { errorBody = await response.text() } catch { /* ignore */ }
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}. ${errorBody}`
    )
  }

  return response.json()
}

// ── Chat ───────────────────────────────────────────────────────────────────────

export async function sendMessage(req: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

// ── Conversations ──────────────────────────────────────────────────────────────

export async function listConversations(): Promise<ConversationSummary[]> {
  return apiFetch<ConversationSummary[]>("/api/conversations")
}

export async function createConversation(
  title = "New Conversation"
): Promise<ConversationSummary> {
  return apiFetch<ConversationSummary>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  })
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/api/conversations/${id}`)
}

export async function deleteConversation(
  id: string
): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/conversations/${id}`, {
    method: "DELETE",
  })
}

// ── Dataset ────────────────────────────────────────────────────────────────────

export async function uploadDataset(
  file: File
): Promise<{ status: string; filename: string; rows: number; message: string }> {
  const fd = new FormData()
  fd.append("file", file)
  return apiUpload("/api/upload-dataset", fd)
}

// ── PDF severity analysis ──────────────────────────────────────────────────────
// Backend route: POST /api/analyze-pdf
// FormData field name: "file"
// FIX: was calling /api/analyze-pdf-severity (wrong) — now /api/analyze-pdf (correct)
// FIX: response uses word_count not text_length

export async function analyzePdfSeverity(file: File): Promise<{
  severity: {
    label: string
    confidence: number
    color: string
    scores: Record<string, number>
    available: boolean
  }
  extracted_text: string
  word_count: number
  what_happened: string | null
  filename: string
}> {
  const fd = new FormData()
  fd.append("file", file)
  return apiUpload("/api/analyze-pdf", fd)  // ← correct route
}

// ── Settings ───────────────────────────────────────────────────────────────────

export async function validateApiKey(
  provider: string,
  api_key: string
): Promise<{ valid: boolean; error: string | null }> {
  return apiFetch("/api/settings/validate-key", {
    method: "POST",
    body: JSON.stringify({ provider, api_key }),
  })
}

export async function getModels(): Promise<Record<string, ModelOption[]>> {
  return apiFetch<Record<string, ModelOption[]>>("/api/settings/models")
}

export async function getStatus(): Promise<StatusResponse> {
  return apiFetch<StatusResponse>("/api/status")
}

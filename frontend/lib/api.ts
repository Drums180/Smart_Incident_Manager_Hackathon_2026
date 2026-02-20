import type {
  ChatRequest,
  ChatResponse,
  ConversationSummary,
  ConversationDetail,
  ModelOption,
  StatusResponse,
  AlertContact,
  AlertLog,
  AlertSettings,
  ContactRole,
} from "./types"

export const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  })
  if (!response.ok) {
    let errorBody = "Unknown error"
    try { errorBody = await response.text() } catch {}
    throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorBody}`)
  }
  return response.json()
}

async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, { method: "POST", body: formData })
  if (!response.ok) {
    let errorBody = "Unknown error"
    try { errorBody = await response.text() } catch {}
    throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorBody}`)
  }
  return response.json()
}

// ── Chat ───────────────────────────────────────────────────────────────────────

export async function sendMessage(req: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/api/chat", { method: "POST", body: JSON.stringify(req) })
}

// ── Conversations ──────────────────────────────────────────────────────────────

export async function listConversations(): Promise<ConversationSummary[]> {
  return apiFetch<ConversationSummary[]>("/api/conversations")
}

export async function createConversation(title = "New Conversation"): Promise<ConversationSummary> {
  return apiFetch<ConversationSummary>("/api/conversations", {
    method: "POST", body: JSON.stringify({ title }),
  })
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/api/conversations/${id}`)
}

export async function deleteConversation(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/conversations/${id}`, { method: "DELETE" })
}

// ── Dataset ────────────────────────────────────────────────────────────────────

export async function uploadDataset(file: File) {
  const fd = new FormData()
  fd.append("file", file)
  return apiUpload<{ status: string; filename: string; rows: number; message: string }>("/api/upload-dataset", fd)
}

// ── Settings ───────────────────────────────────────────────────────────────────

export async function validateApiKey(provider: string, api_key: string) {
  return apiFetch<{ valid: boolean; error: string | null }>("/api/settings/validate-key", {
    method: "POST", body: JSON.stringify({ provider, api_key }),
  })
}

export async function getModels(): Promise<Record<string, ModelOption[]>> {
  return apiFetch<Record<string, ModelOption[]>>("/api/settings/models")
}

export async function getStatus(): Promise<StatusResponse> {
  return apiFetch<StatusResponse>("/api/status")
}

// ── PDF Analysis ───────────────────────────────────────────────────────────────

export async function analyzePdfSeverity(file: File): Promise<{
  severity: { label: string; confidence: number; color: string; scores: Record<string, number>; available: boolean }
  extracted_text: string
  word_count: number
  what_happened: string | null
  filename: string
}> {
  const fd = new FormData()
  fd.append("file", file)
  return apiUpload("/api/analyze-pdf", fd)
}

// ── Alert Contacts ─────────────────────────────────────────────────────────────

export async function listContacts(): Promise<AlertContact[]> {
  return apiFetch<AlertContact[]>("/api/contacts")
}

export async function createContact(data: {
  name: string; email: string; role: ContactRole; phone?: string
}): Promise<AlertContact> {
  return apiFetch<AlertContact>("/api/contacts", {
    method: "POST", body: JSON.stringify(data),
  })
}

export async function deleteContact(id: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/contacts/${id}`, { method: "DELETE" })
}

// ── Alert Logs ─────────────────────────────────────────────────────────────────

export async function listAlerts(): Promise<AlertLog[]> {
  return apiFetch<AlertLog[]>("/api/alerts")
}

export async function testAlert(): Promise<{ triggered: boolean; contacts_notified: number; alert_id: string }> {
  return apiFetch("/api/alerts/test", { method: "POST" })
}

// ── Alert Settings ─────────────────────────────────────────────────────────────

export async function getAlertSettings(): Promise<AlertSettings> {
  return apiFetch<AlertSettings>("/api/alerts/settings")
}

export async function updateAlertSettings(threshold: number): Promise<AlertSettings> {
  return apiFetch<AlertSettings>("/api/alerts/settings", {
    method: "POST", body: JSON.stringify({ threshold }),
  })
}

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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })

  if (!response.ok) {
    let errorBody: string
    try {
      errorBody = await response.text()
    } catch {
      errorBody = "Unknown error"
    }
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}. ${errorBody}`
    )
  }

  return response.json()
}

export async function sendMessage(req: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return apiFetch<ConversationSummary[]>("/api/conversations")
}

export async function createConversation(
  title: string = "New Conversation"
): Promise<ConversationSummary> {
  return apiFetch<ConversationSummary>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  })
}

export async function getConversation(
  id: string
): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/api/conversations/${id}`)
}

export async function deleteConversation(
  id: string
): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/api/conversations/${id}`, {
    method: "DELETE",
  })
}

export async function uploadDataset(
  file: File
): Promise<{ status: string; filename: string; rows: number; message: string }> {
  const formData = new FormData()
  formData.append("file", file)

  const url = `${BASE_URL}/api/upload-dataset`
  const response = await fetch(url, {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    let errorBody: string
    try {
      errorBody = await response.text()
    } catch {
      errorBody = "Unknown error"
    }
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}. ${errorBody}`
    )
  }

  return response.json()
}

export async function validateApiKey(
  provider: string,
  api_key: string
): Promise<{ valid: boolean; error: string | null }> {
  return apiFetch<{ valid: boolean; error: string | null }>(
    "/api/settings/validate-key",
    {
      method: "POST",
      body: JSON.stringify({ provider, api_key }),
    }
  )
}

export async function getModels(): Promise<
  Record<string, ModelOption[]>
> {
  return apiFetch<Record<string, ModelOption[]>>("/api/settings/models")
}

export async function getStatus(): Promise<StatusResponse> {
  return apiFetch<StatusResponse>("/api/status")
}

export async function analyzePdfSeverity(
  file: File
): Promise<{
  severity: {
    label: string
    confidence: number
    color: string
    scores: Record<string, number>
    available: boolean
  }
  extracted_text: string
  text_length: number
}> {
  const formData = new FormData()
  formData.append("file", file)

  const url = `${BASE_URL}/api/analyze-pdf-severity`
  const response = await fetch(url, {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    let errorBody: string
    try {
      errorBody = await response.text()
    } catch {
      errorBody = "Unknown error"
    }
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}. ${errorBody}`
    )
  }

  return response.json()
}

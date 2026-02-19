# CURSOR PROMPTS — Safety AnalystBot Frontend
# Run these IN ORDER. Each one builds on the last.
# Paste the full block into Cursor chat (CMD+L / CTRL+L) each time.
# Don't skip steps — later prompts assume earlier ones are done.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 0 — PROJECT INIT (run once in terminal, NOT in Cursor chat)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run these commands in your terminal:

  npx create-next-app@latest frontend --typescript --tailwind --app --no-src-dir --import-alias "@/*"
  cd frontend
  npm install lucide-react zustand
  npx shadcn@latest init -d
  npx shadcn@latest add button input textarea badge scroll-area separator

Then open the frontend/ folder in Cursor.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 1 — TYPES + API CLIENT
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create two files: lib/types.ts and lib/api.ts

─── lib/types.ts ───────────────────────────────────────────────
Define and export these TypeScript interfaces:

```ts
interface Source {
  record_id: string
  title: string
  severity: string
  section: string
  location: string
  year: string
  score: number
}

interface SeverityResult {
  label: string         // "Major" | "Serious" | "Potentially Significant" | "Near Miss" | "Minor" | "Unknown"
  confidence: number    // 0.0–1.0
  color: string         // hex color string like "#ef4444"
  scores: Record<string, number>
  available: boolean
}

interface Message {
  id: string
  conversation_id: string
  role: "user" | "assistant"
  content: string
  sources: Source[]
  severity: SeverityResult | null
  created_at: string
}

interface ConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

interface ConversationDetail extends ConversationSummary {
  messages: Message[]
}

interface ChatRequest {
  message: string
  conversation_id: string | null
  provider: "groq" | "anthropic"
  api_key: string
  model?: string
  n_results?: number
  filters?: Record<string, unknown> | null
}

interface ChatResponse {
  conversation_id: string
  answer: string
  sources: Source[]
  severity: SeverityResult
  parsed_filters: Record<string, unknown>
  is_new_conversation: boolean
}

interface IndexStats {
  status: string
  chunks: number
  records: number
  years: number[]
  severity_dist: Record<string, number>
}

interface StatusResponse {
  rag: IndexStats
  severity: { available: boolean }
  rebuilding: boolean
}

interface ModelOption {
  id: string
  label: string
}
```

─── lib/api.ts ─────────────────────────────────────────────────
Create a typed API client. Import all types from lib/types.ts.

- Export: const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

- Create a helper: async function apiFetch<T>(path, options?): Promise<T>
  that prepends BASE_URL, throws a descriptive error on non-2xx responses
  (include status code and response body in the error message).

- Export these typed async functions:

  sendMessage(req: ChatRequest): Promise<ChatResponse>
    POST /api/chat — body is the full ChatRequest object

  listConversations(): Promise<ConversationSummary[]>
    GET /api/conversations

  createConversation(title?: string): Promise<ConversationSummary>
    POST /api/conversations — body: { title }

  getConversation(id: string): Promise<ConversationDetail>
    GET /api/conversations/{id}

  deleteConversation(id: string): Promise<{ deleted: boolean }>
    DELETE /api/conversations/{id}

  uploadDataset(file: File): Promise<{ status: string; filename: string; rows: number; message: string }>
    POST /api/upload-dataset — multipart form, field name "file"

  validateApiKey(provider: string, api_key: string): Promise<{ valid: boolean; error: string | null }>
    POST /api/settings/validate-key

  getModels(): Promise<Record<string, ModelOption[]>>
    GET /api/settings/models

  getStatus(): Promise<StatusResponse>
    GET /api/status


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 2 — ZUSTAND STORE
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create lib/store.ts with two Zustand stores.
Import types from lib/types.ts.

─── Store 1: useSettingsStore ──────────────────────────────────
Persisted to localStorage using zustand/middleware persist.
Storage key: "safety-bot-settings"

State shape:
  provider: "groq" | "anthropic"   — default "groq"
  api_key: string                   — default ""
  model: string | null              — default null (means use provider default)
  n_results: number                 — default 8

Actions: setProvider, setApiKey, setModel, setNResults
Each action simply sets the corresponding field.

─── Store 2: useChatStore ──────────────────────────────────────
NOT persisted — in memory only.

State shape:
  activeConversationId: string | null   — default null
  conversations: ConversationSummary[]  — default []
  messages: Message[]                   — default []
  isLoading: boolean                    — default false
  isRebuilding: boolean                 — default false

Actions:
  setActiveConversationId(id: string | null): void
  setConversations(convs: ConversationSummary[]): void
  setMessages(msgs: Message[]): void
  addMessage(msg: Message): void
    — appends to messages array
  addOptimisticUserMessage(content: string): string
    — creates a fake Message with role "user", a temp UUID id, current timestamp
    — appends it to messages, returns the temp id
  addLoadingPlaceholder(): string
    — creates a fake Message with role "assistant", isLoading: true (add this field to Message or use a local convention)
    — actually: add an "id" field we can use to replace it
    — returns the placeholder id
  resolveAssistantMessage(placeholderId: string, content: string, sources: Source[], severity: SeverityResult): void
    — finds the placeholder by id and replaces it with real data
  setLoading(b: boolean): void
  setRebuilding(b: boolean): void

Note: for the loading placeholder, add an optional `isLoading?: boolean` field
to the Message type in lib/types.ts.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 3 — ROOT LAYOUT + PAGE SHELL
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Update app/layout.tsx and app/page.tsx.

─── app/globals.css ────────────────────────────────────────────
Add these CSS custom properties to :root (after existing Tailwind directives):

  --bg: #0a0c10;
  --surface: #0f1117;
  --card: #161b22;
  --border: #21262d;
  --accent: #3b82f6;
  --text: #e6edf3;
  --text-muted: #8b949e;

Set body background to var(--bg) and color to var(--text).
Import JetBrains Mono from Google Fonts.

─── app/layout.tsx ─────────────────────────────────────────────
- Import Inter and JetBrains Mono from next/font/google
- Dark background, full viewport height, no overflow on body
- Apply fonts as CSS variables: --font-sans, --font-mono

─── app/page.tsx ───────────────────────────────────────────────
"use client" page.

Layout: full viewport height flex column. No page scroll.

Top header bar (h-10, 40px):
  - background: var(--surface)
  - border-bottom: 1px solid var(--border)
  - flex row, items-center, px-4, justify-between
  - Left: "⚡ Safety AnalystBot" — font-mono, text-sm, text accent blue (#3b82f6), font-semibold
  - Right: Settings button — ghost button with Settings icon (lucide-react), opens SettingsModal

Below header: flex row, flex-1, overflow-hidden
  - Left panel: w-[55%], border-right 1px solid var(--border), background var(--surface)
    Just a placeholder div: centered text "Dashboard Panel" in text-muted, text-sm
  - Right panel: w-[45%], flex column, overflow-hidden
    Renders <ChatPanel />

useState for isSettingsOpen (default false).
Render <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

Import ChatPanel from components/ChatPanel.tsx (we'll create it next — just stub it for now so the file compiles).
Import SettingsModal from components/SettingsModal.tsx (same — stub it).


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 4 — SETTINGS MODAL
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create components/SettingsModal.tsx

Props: { open: boolean; onClose: () => void }

It's a slide-in panel from the right side of the screen.
When open=false, render nothing (return null).
When open=true:

Outer: fixed inset-0, z-50
  - Dark backdrop: absolute inset-0, bg-black/60, onClick closes modal
  - Panel: absolute right-0 top-0 bottom-0, w-[400px]
    background: var(--card)
    border-left: 1px solid var(--border)
    flex column, overflow-y-auto, p-6, gap-6

Panel content (top to bottom):

1. HEADER ROW
   "Settings" in text-base font-semibold + X button top-right that calls onClose

2. PROVIDER SECTION  (label: "AI Provider")
   Two buttons side by side: "Groq" and "Anthropic"
   Active one: border-accent + bg-accent/10 + text-accent
   Inactive: border-border, text-muted
   Clicking sets provider in useSettingsStore
   Under each button, small helper text:
     Groq: "Free · Fast · Llama 3.3 70B"
     Anthropic: "Paid · Best quality · Claude"

3. API KEY SECTION  (label: "API Key")
   - Password input (type="password") with show/hide toggle (Eye/EyeOff lucide icon)
   - Value bound to api_key from store, onChange calls setApiKey
   - Below the input: "Test Connection" button
     On click: calls validateApiKey(provider, api_key) from lib/api.ts
     While testing: spinner + "Testing..."
     On success: green checkmark + "Connected ✓"
     On failure: red X + error message (truncated to 60 chars)
   - Test result clears when api_key or provider changes

4. MODEL SECTION  (label: "Model")
   - Fetch models from GET /api/settings/models on mount (useEffect)
   - Select dropdown showing models for the current provider
   - First option: "Use provider default" (value = "")
   - Value bound to model from store, onChange calls setModel

5. RETRIEVAL DEPTH  (label: "Sources per query")
   - Range input: min=4, max=16, step=2
   - Current value shown: "Retrieving {n_results} sources"
   - Value bound to n_results, onChange calls setNResults

6. DATASET SECTION  (label: "Dataset Management")
   - Current status from GET /api/status (fetch on mount):
     "196 records · 752 chunks · 2019–2024"  (use rag stats)
   - File drop zone:
     Dashed border, rounded, p-4, text-center
     "Drop CSV here or click to browse"
     Accept: .csv only
     When file selected: show filename + size
   - "Rebuild Index" button (disabled if no file selected or isRebuilding)
     On click: call uploadDataset(file) from lib/api.ts
     Start polling GET /api/status every 3 seconds
     Show progress: spinner + "Rebuilding index..."
     When rebuilding: false → show "✅ Done — {chunks} chunks indexed"
     Stop polling when rebuilding is false

7. FOOTER
   Small text: "Keys are stored in your browser only. Never sent to any server except the AI provider."
   text-xs, text-muted, text-center


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 5 — SEVERITY BADGE COMPONENT
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create components/SeverityBadge.tsx

Props: { severity: SeverityResult }

If severity.available is false, return null.

Render a small pill badge:
  - Background: severity.color at 15% opacity (use inline style: backgroundColor + "26" hex suffix for ~15%)
  - Border: 1px solid severity.color at 40% opacity
  - Text color: severity.color
  - Padding: px-2 py-0.5, rounded-full, text-xs, font-medium
  - Content: "{severity.label}  ·  {Math.round(severity.confidence * 100)}% confidence"

Also create components/SourcesPanel.tsx

Props: { sources: Source[] }

If sources.length === 0, return null.

Collapsible section — collapsed by default.
Toggle button: "▸ {sources.length} sources used" / "▾ {sources.length} sources used"
text-xs, text-muted, cursor-pointer, hover:text-white

When expanded, render a vertical list of source cards.
Each card:
  - background: var(--surface), border: var(--border), rounded, p-2, text-xs
  - Row 1: "#{record_id} · {title truncated to 45 chars}"  font-mono, text-white
  - Row 2: "{location} · {year} · {section}"  text-muted
  - Row 3: Severity colored dot + label (use severity color map below) + score bar
    Score bar: thin div, w-full, bg-border, h-1, rounded
    Inner fill: bg-accent, width = "{score * 100}%"

Severity color map (hardcode these):
  Major: #ef4444
  Serious: #f97316
  Potentially Significant: #eab308
  Near Miss: #3b82f6
  Minor: #6b7280
  default: #9ca3af


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 6 — MESSAGE BUBBLE
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create components/MessageBubble.tsx

Props: { message: Message }

─── USER MESSAGE ───────────────────────────────────────────────
Align right (flex justify-end, w-full).
Bubble: max-w-[80%], bg: #1d2230, rounded-2xl rounded-br-sm, px-4 py-3
Text: text-sm, text-[var(--text)], whitespace-pre-wrap
Below bubble, right-aligned: timestamp in text-xs text-muted
  Format: use toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})

─── ASSISTANT MESSAGE ──────────────────────────────────────────
Full width (w-full), flex column, gap-2.

Row 1: small header — Bot icon (lucide-react BotMessageSquare or Bot) 14px +
  "Safety AnalystBot" in text-xs text-muted

Row 2: <SeverityBadge severity={message.severity} /> (only if severity exists)

Row 3: Message content rendered as simple markdown.
  DO NOT use a markdown library. Instead write a simple renderer:
  - Split by \n\n for paragraphs
  - Replace **text** with <strong>text</strong>
  - Replace *text* with <em>text</em>
  - Lines starting with "- " or "• " become bullet points (<ul><li>)
  - Lines starting with a number+". " become ordered list items
  Group consecutive bullet lines into a single <ul> block.
  Each paragraph in a <p> with mb-3 spacing.
  Text: text-sm, leading-relaxed, text-[var(--text)]

Row 4: <SourcesPanel sources={message.sources || []} />

─── LOADING STATE ──────────────────────────────────────────────
When message.isLoading is true, show the assistant layout but replace
Row 3 content with a typing indicator:
  Three dots animating: use Tailwind animate-bounce with staggered delays
  on three small circles (w-2 h-2, rounded-full, bg-muted)
  delays: delay-0, delay-100, delay-200


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 7 — WELCOME SCREEN
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create components/WelcomeScreen.tsx

Props: { onQuestion: (q: string) => void }

Fetches GET /api/status on mount to get chunk count.

Layout: h-full flex flex-col items-center justify-center gap-8 p-8

Title block (centered):
  Large icon: ShieldCheck from lucide-react, size 40, color accent blue
  Heading: "Safety AnalystBot" — text-2xl font-semibold
  Subheading: "Ask anything about the safety incident records" — text-sm text-muted

Suggested questions grid: grid grid-cols-2 gap-3, max-w-lg, w-full

6 question cards:
  1. "What are the most common root causes of Major incidents?"
  2. "How did incidents change from 2022 to 2024?"
  3. "What incidents happened in Vancouver?"
  4. "Which AI system failures caused the most damage?"
  5. "Give me a pre-shift brief for valve isolation work tomorrow"
  6. "What patterns keep repeating across all incidents?"

Each card:
  - background: var(--card)
  - border: 1px solid var(--border)
  - hover: border-color accent, bg slightly lighter
  - rounded-lg, p-3, cursor-pointer
  - text-sm, text-[var(--text)], leading-snug
  - transition-colors duration-150
  - onClick: calls onQuestion(question)

Footer text (centered, text-xs, text-muted):
  "⚡ {chunkCount > 0 ? `${chunkCount} chunks indexed` : 'Loading index...'}"


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 8 — CHAT PANEL (main component, wires everything together)
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create components/ChatPanel.tsx — the complete right panel.
"use client"

This is the most complex component. Build it carefully.

─── IMPORTS ────────────────────────────────────────────────────
useRef, useState, useEffect, useCallback from react
useChatStore, useSettingsStore from lib/store
sendMessage, listConversations, getConversation, deleteConversation, createConversation from lib/api
MessageBubble, WelcomeScreen
Send, Plus, Trash2 icons from lucide-react
All types from lib/types

─── LAYOUT ─────────────────────────────────────────────────────
Full height (h-full), flex row, overflow-hidden.

LEFT SIDEBAR — w-[240px], flex-shrink-0, flex flex-col
  background: var(--surface)
  border-right: 1px solid var(--border)
  overflow: hidden

  SIDEBAR HEADER: px-3 py-3, flex justify-between items-center
    "Conversations" text-xs font-semibold text-muted uppercase tracking-wider
    "+" button (Plus icon, 14px): onClick calls handleNewChat()

  SIDEBAR LIST: flex-1, overflow-y-auto
    Maps over conversations from store.
    Each item:
      - px-3 py-2.5, cursor-pointer, flex items-start justify-between, gap-2
      - Active (id === activeConversationId): border-left 2px solid accent, bg-[#1a2030]
      - Inactive hover: bg-white/5
      - Left content: flex flex-col gap-0.5
          Title: text-xs, text-[var(--text)], truncate, max-w-[160px]
          Timestamp: text-[10px], text-muted (relative: "2h ago", "Yesterday", etc.)
      - Right: trash icon button (Trash2, 12px), only visible on hover, text-muted hover:text-red-400
          onClick: calls handleDeleteConversation(id), stops propagation

    Empty state: p-4 text-center text-xs text-muted
      "No conversations yet.\nStart chatting!"

RIGHT CHAT AREA — flex-1, flex flex-col, overflow-hidden

  CHAT HEADER: h-12, px-4, flex items-center, border-bottom 1px solid var(--border), flex-shrink-0
    If no active conversation: "New Conversation" in text-sm text-muted
    If active: conversation title in text-sm font-medium

  MESSAGE LIST: flex-1, overflow-y-auto, px-4 py-4, flex flex-col gap-4
    Ref: messagesEndRef on an empty div at the very bottom (for auto-scroll)
    If no messages AND no activeConversationId:
      Render <WelcomeScreen onQuestion={handleSendMessage} />
    Else:
      Map messages → <MessageBubble key={msg.id} message={msg} />
    Auto-scroll: useEffect on messages.length → messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })

  INPUT AREA: flex-shrink-0, border-top 1px solid var(--border), p-3
    Flex row, gap-2, items-end
    Textarea:
      - flex-1, resize-none, bg-[var(--card)], border var(--border)
      - rounded-xl, px-3 py-2.5, text-sm, text-[var(--text)]
      - placeholder: "Ask about safety incidents..."
      - rows=1 but auto-grows (use onInput to set scrollHeight)
      - max height: 120px (5 lines approx)
      - onKeyDown: Enter (without Shift) → handleSendMessage(); Shift+Enter → newline
      - disabled when isLoading
    Send button:
      - rounded-xl, p-2.5, bg-accent, hover:bg-accent/80
      - disabled: isLoading or input.trim() === ""
      - onClick: handleSendMessage()
      - Icon: Send (lucide), 16px, white

─── LOGIC ──────────────────────────────────────────────────────

State:
  inputValue: string
  textareaRef: RefObject<HTMLTextAreaElement>
  messagesEndRef: RefObject<HTMLDivElement>

On mount:
  - Call listConversations() → store.setConversations()

handleNewChat():
  - store.setActiveConversationId(null)
  - store.setMessages([])

handleSelectConversation(id):
  - store.setActiveConversationId(id)
  - Call getConversation(id) → store.setMessages(conv.messages)

handleDeleteConversation(id):
  - Call deleteConversation(id)
  - If id === activeConversationId: handleNewChat()
  - Refresh conversation list

handleSendMessage(text?: string):
  - Resolve message from text param OR inputValue
  - If empty: return
  - Clear inputValue, reset textarea height
  - store.setLoading(true)

  // Optimistic UI
  - const userMsgId = store.addOptimisticUserMessage(message)
  - const placeholderId = store.addLoadingPlaceholder()

  try:
    const settings = useSettingsStore.getState()
    const res = await sendMessage({
      message,
      conversation_id: store.activeConversationId,
      provider: settings.provider,
      api_key: settings.api_key,
      model: settings.model || undefined,
      n_results: settings.n_results,
    })

    // If new conversation, update state and refresh list
    if (res.is_new_conversation) {
      store.setActiveConversationId(res.conversation_id)
      const convs = await listConversations()
      store.setConversations(convs)
    }

    // Replace placeholder with real response
    store.resolveAssistantMessage(placeholderId, res.answer, res.sources, res.severity)

  catch (err):
    store.resolveAssistantMessage(placeholderId, "Sorry, something went wrong. Check Settings and try again.", [], null)

  finally:
    store.setLoading(false)
    textareaRef.current?.focus()

─── RELATIVE TIMESTAMP HELPER ──────────────────────────────────
Write a formatRelativeTime(isoString: string): string function:
  - < 1 minute ago: "Just now"
  - < 60 minutes: "Xm ago"
  - < 24 hours: "Xh ago"
  - Yesterday: "Yesterday"
  - Else: locale date string


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPT 9 — DEPLOYMENT FILES
Paste this into Cursor chat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Create these files exactly as specified:

─── backend/Procfile ───────────────────────────────────────────
web: uvicorn main:app --host 0.0.0.0 --port $PORT

─── frontend/.env.local ────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:8000

─── frontend/.env.production ───────────────────────────────────
NEXT_PUBLIC_API_URL=https://YOUR_RENDER_APP.onrender.com

─── .gitignore (root of project) ───────────────────────────────
# Python
__pycache__/
*.py[cod]
*.pyo
.env
.venv/
venv/

# Data (too large or sensitive for git)
backend/data/chroma_db/
backend/data/conversations.db
backend/uploads/

# Node
frontend/node_modules/
frontend/.next/
frontend/.env.local
frontend/.env.production

# OS
.DS_Store
Thumbs.db

─── README.md (root) ───────────────────────────────────────────
Create a README with these sections:

## Safety AnalystBot

Two-panel app: safety dashboard + RAG-powered chatbot over 196 incident records.

### Stack
- Backend: FastAPI + ChromaDB + Sentence Transformers + Groq/Anthropic
- Frontend: Next.js 14 + Tailwind + Zustand

### Run locally

**Backend**
  cd backend
  pip install -r requirements.txt
  cp .env.example .env
  # Add hackathon_base_table.csv to backend/data/
  # Add severity_model.pkl to backend/models/ (optional)
  uvicorn main:app --reload

**Frontend**
  cd frontend
  npm install
  npm run dev

### Deploy

**Backend → Render**
1. Push to GitHub
2. New Web Service → connect repo → Root Directory: backend
3. Build command: pip install -r requirements.txt
4. Start command: uvicorn main:app --host 0.0.0.0 --port $PORT
5. Add env vars: FRONTEND_URL (your Vercel URL)

**Frontend → Vercel**
1. Import repo → Root Directory: frontend
2. Add env var: NEXT_PUBLIC_API_URL (your Render URL)

### Environment variables
Backend: FRONTEND_URL, CHROMA_PATH, DEFAULT_CSV_PATH, SEVERITY_MODEL_PATH
Frontend: NEXT_PUBLIC_API_URL


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEBUGGING TIPS (keep this handy)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If the backend won't start:
  → Check you copied hackathon_base_table.csv into backend/data/
  → Run: cd backend && pip install -r requirements.txt
  → The first startup takes ~90 seconds (building the embedding index)

If chat returns 400 "api_key required":
  → Open Settings modal in the UI and add your Groq key
  → Get a free key at console.groq.com

If severity badge never shows:
  → severity_model.pkl is optional. Get it from your teammate and drop it in backend/models/
  → Check GET /api/status → severity.available should be true

If Vancouver queries return wrong results:
  → This is handled in rag.py parse_query() via LOCATION_MAP
  → The city filter is applied as a ChromaDB metadata pre-filter before semantic search

CORS errors in browser:
  → Make sure FRONTEND_URL in backend/.env matches exactly (including http/https and port)
  → In production: set FRONTEND_URL to your Vercel deployment URL

Render cold start (30s delay on first request):
  → Wake up the server before your demo: open the app ~2 minutes early
  → Or upgrade to Render Starter ($7/month) to avoid spin-down

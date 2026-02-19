"""
main.py
-------
FastAPI backend for Safety AnalystBot.

Endpoints:
  GET    /health                        liveness probe
  GET    /api/status                    index stats + model status
  POST   /api/chat                      main RAG Q&A
  GET    /api/conversations             list all conversation threads
  POST   /api/conversations             create empty conversation
  GET    /api/conversations/{id}        full thread with messages
  DELETE /api/conversations/{id}        delete thread + messages
  POST   /api/upload-dataset            upload CSV, rebuild index
  POST   /api/settings/validate-key     test an API key
  GET    /api/settings/models           available models per provider
"""

import os
import shutil
import logging
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

import rag
import llm
import db
import severity

# ── Config ─────────────────────────────────────────────────────────────────────

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

CHROMA_PATH  = os.getenv("CHROMA_PATH",          "data/chroma_db")
CSV_PATH     = os.getenv("DEFAULT_CSV_PATH",      "data/hackathon_base_table.csv")
PKL_PATH     = os.getenv("SEVERITY_MODEL_PATH",   "models/severity_model.pkl")
DB_PATH      = os.getenv("DB_PATH",               "data/conversations.db")
FRONTEND_URL = os.getenv("FRONTEND_URL",          "http://localhost:3000")

# Rebuild lock — prevents concurrent index rebuilds
_rebuilding = False


# ══════════════════════════════════════════════════════════════════════════════
# LIFESPAN  (startup / shutdown)
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("▶ Starting Safety AnalystBot backend...")

    # Ensure directories exist
    for d in ["data", "models", "uploads"]:
        Path(d).mkdir(exist_ok=True)

    # Init SQLite
    db.init_db(DB_PATH)

    # Init RAG (load CSV → build/load ChromaDB)
    if Path(CSV_PATH).exists():
        rag.initialize(CSV_PATH, CHROMA_PATH)
    else:
        logger.warning(
            f"Dataset not found at '{CSV_PATH}'. "
            "Upload a CSV via POST /api/upload-dataset to get started."
        )

    # Init severity model (.pkl)
    severity.load_model(PKL_PATH)

    logger.info("✅ Backend ready")
    yield
    logger.info("■ Backend shutting down")


# ══════════════════════════════════════════════════════════════════════════════
# APP
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Safety AnalystBot API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════════════
# REQUEST / RESPONSE MODELS
# ══════════════════════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    message:         str
    conversation_id: Optional[str] = None  # None → create new conversation
    provider:        str  = "groq"
    api_key:         str  = ""
    model:           Optional[str] = None
    n_results:       int  = 8
    filters:         Optional[dict] = None


class NewConversationRequest(BaseModel):
    title: str = "New Conversation"


class ValidateKeyRequest(BaseModel):
    provider: str
    api_key:  str


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def api_status():
    """Index stats, model availability, and rebuild flag for the frontend."""
    return {
        "rag":        rag.get_index_stats(),
        "severity":   {"available": severity.is_loaded()},
        "rebuilding": _rebuilding,
    }


# ── Chat ───────────────────────────────────────────────────────────────────────

@app.post("/api/chat")
def chat(req: ChatRequest):
    """
    Main RAG chat endpoint.

    Flow:
      1. Create or load conversation
      2. Retrieve relevant chunks (RAG)
      3. Build context block for LLM
      4. Load conversation history from DB
      5. Call LLM (Groq / Anthropic)
      6. Run severity prediction on user message (.pkl)
      7. Persist user + assistant messages
      8. Return answer + sources + severity to frontend
    """
    global _rebuilding

    if _rebuilding:
        raise HTTPException(503, "Index rebuild in progress. Try again in a moment.")

    if not req.api_key:
        raise HTTPException(400, "api_key is required. Open Settings and add your key.")

    # ── 1. Conversation
    is_new  = req.conversation_id is None
    conv_id = req.conversation_id

    if is_new:
        conv    = db.create_conversation()
        conv_id = conv["id"]
    else:
        if not db.get_conversation(conv_id):
            raise HTTPException(404, f"Conversation '{conv_id}' not found.")

    # ── 2. Retrieve chunks
    try:
        hits, parsed_info = rag.retrieve(
            req.message,
            n_results=  req.n_results,
            filters=    req.filters,
            auto_parse= True,
        )
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    # ── 3. Format context + sources
    sources = [
        {
            "record_id": h["metadata"]["report_id"],
            "title":     h["metadata"]["title"],
            "severity":  h["metadata"]["severity"],
            "section":   h["metadata"]["section"],
            "location":  h["metadata"].get("city") or h["metadata"].get("country") or "Unknown",
            "year":      h["metadata"]["year"],
            "score":     h["score"],
        }
        for h in hits
    ]

    context_block = _format_context(hits)
    note          = f"\n\n[Auto-detected filters: {parsed_info}]" if parsed_info else ""
    user_content  = (
        f"Source records:\n\n{context_block}{note}\n\n"
        f"---\n\nQuestion: {req.message}"
    )

    # ── 4. Load history + append current message
    history = db.get_history_for_llm(conv_id, max_turns=8)
    history.append({"role": "user", "content": user_content})

    # ── 5. Call LLM
    try:
        answer = llm.call_llm(
            messages=    history,
            provider=    req.provider,
            api_key=     req.api_key,
            model=       req.model,
            max_tokens=  1400,
            temperature= 0.2,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"LLM call failed: {e}")

    # ── 6. Severity prediction
    sev = severity.predict(req.message)

    # ── 7. Persist messages
    db.add_message(conv_id, "user",      req.message)
    db.add_message(conv_id, "assistant", answer, sources=sources, severity=sev)

    if is_new:
        db.auto_title_from_message(conv_id, req.message)

    # ── 8. Return
    return {
        "conversation_id":      conv_id,
        "answer":               answer,
        "sources":              sources,
        "severity":             sev,
        "parsed_filters":       parsed_info,
        "is_new_conversation":  is_new,
    }


def _format_context(hits: list[dict]) -> str:
    """Format retrieved chunks into a clean block for the LLM."""
    blocks = []
    for i, h in enumerate(hits):
        m    = h["metadata"]
        loc  = m.get("city") or m.get("country") or "Unknown"
        body = h["text"].split("\n\n", 1)[-1][:600]
        blocks.append(
            f"SOURCE {i+1} [#{m['report_id']} | {m['severity']} | "
            f"{loc} | {m['year']} | {m['section']}]\n"
            f"Title: {m['title']}\n{body}"
        )
    return "\n\n---\n\n".join(blocks)


# ── Conversations ──────────────────────────────────────────────────────────────

@app.get("/api/conversations")
def list_conversations():
    return db.list_conversations()


@app.post("/api/conversations")
def create_conversation(req: NewConversationRequest):
    return db.create_conversation(req.title)


@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: str):
    conv = db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found.")
    return {**conv, "messages": db.get_messages(conv_id)}


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str):
    if not db.get_conversation(conv_id):
        raise HTTPException(404, "Conversation not found.")
    db.delete_conversation(conv_id)
    return {"deleted": True}


# ── Dataset upload ─────────────────────────────────────────────────────────────

@app.post("/api/upload-dataset")
async def upload_dataset(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """
    Upload a new CSV → validates columns → rebuilds RAG index in background.
    Poll GET /api/status to check rebuilding: true/false.
    """
    global _rebuilding

    if _rebuilding:
        raise HTTPException(409, "A rebuild is already in progress.")

    if not (file.filename or "").endswith(".csv"):
        raise HTTPException(400, "Only .csv files are accepted.")

    import pandas as pd
    import io

    contents = await file.read()

    # Validate CSV structure
    try:
        df_check = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(400, f"Could not parse CSV: {e}")

    required = {"report_id", "title", "severity", "what_happened", "why_did_it_happen"}
    missing  = required - set(df_check.columns)
    if missing:
        raise HTTPException(
            400,
            f"CSV missing required columns: {missing}. "
            f"Got: {list(df_check.columns)}"
        )

    # Save file
    save_path = f"uploads/{file.filename}"
    with open(save_path, "wb") as f_out:
        f_out.write(contents)

    # Kick off background rebuild
    background_tasks.add_task(_rebuild_index_task, save_path)

    return {
        "status":   "rebuild_started",
        "filename": file.filename,
        "rows":     len(df_check),
        "message":  "Index rebuild started. Poll GET /api/status until rebuilding: false.",
    }


def _rebuild_index_task(new_csv_path: str):
    global _rebuilding
    _rebuilding = True
    try:
        logger.info(f"Rebuilding index from {new_csv_path}...")
        shutil.copy(new_csv_path, CSV_PATH)
        rag.initialize(CSV_PATH, CHROMA_PATH, force_rebuild=True)
        logger.info("Index rebuild complete ✅")
    except Exception as e:
        logger.error(f"Index rebuild failed: {e}")
    finally:
        _rebuilding = False


# ── Settings ───────────────────────────────────────────────────────────────────

@app.post("/api/settings/validate-key")
def validate_key(req: ValidateKeyRequest):
    """Test an API key. Returns {valid: bool, error: str | null}."""
    return llm.validate_api_key(req.provider, req.api_key)


@app.get("/api/settings/models")
def get_models():
    """Available models per provider for the settings dropdown."""
    return llm.PROVIDER_MODELS


# ── PDF Severity Analysis ─────────────────────────────────────────────────────────

@app.post("/api/analyze-pdf-severity")
async def analyze_pdf_severity(file: UploadFile = File(...)):
    """
    Upload a PDF report → extract "What happened" section → run severity model.
    Returns severity prediction result.
    """
    if not (file.filename or "").endswith(".pdf"):
        raise HTTPException(400, "Only .pdf files are accepted.")

    import PyPDF2
    import io

    contents = await file.read()

    # Extract text from PDF
    try:
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(contents))
        full_text = ""
        for page in pdf_reader.pages:
            full_text += page.extract_text() + "\n"
    except Exception as e:
        raise HTTPException(400, f"Could not parse PDF: {e}")

    # Extract "What happened" section
    # Look for section starting with "What happened" (case insensitive)
    # and ending at next major section (What could have happened, Why did it happen, etc.)
    import re
    
    # Find "What happened" section - handle various formats
    # Pattern matches "What happened" followed by optional colon/newlines, then captures text
    # until next section header (case insensitive)
    pattern = r"(?i)(?:^|\n)\s*what\s+happened\s*:?\s*\n\s*(.*?)(?=\n\s*(?:What\s+could\s+have\s+happened|Why\s+did\s+it\s+happen|Causal\s+factors|What\s+went\s+well|Lessons\s+to\s+prevent|Actions\s*$|$))"
    match = re.search(pattern, full_text, re.DOTALL | re.IGNORECASE | re.MULTILINE)
    
    if not match:
        raise HTTPException(400, "Could not find 'What happened' section in PDF. Please ensure the PDF contains this section.")
    
    what_happened_text = match.group(1).strip()
    
    if not what_happened_text:
        raise HTTPException(400, "Found 'What happened' section but it appears to be empty.")
    
    # Run severity prediction
    sev_result = severity.predict(what_happened_text)
    
    return {
        "severity": sev_result,
        "extracted_text": what_happened_text[:500] + "..." if len(what_happened_text) > 500 else what_happened_text,
        "text_length": len(what_happened_text),
    }

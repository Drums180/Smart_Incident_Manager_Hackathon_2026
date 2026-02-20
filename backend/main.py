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
  POST   /api/analyze-pdf              extract text from PDF → severity prediction
  POST   /api/settings/validate-key     test an API key
  GET    /api/settings/models           available models per provider
"""

import os
import shutil
import logging
from pathlib import Path
from typing import Optional, List
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

_rebuilding = False


# ══════════════════════════════════════════════════════════════════════════════
# LIFESPAN
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("▶ Starting Safety AnalystBot backend...")
    for d in ["data", "models", "uploads"]:
        Path(d).mkdir(exist_ok=True)
    db.init_db(DB_PATH)
    if Path(CSV_PATH).exists():
        rag.initialize(CSV_PATH, CHROMA_PATH)
    else:
        logger.warning(f"Dataset not found at '{CSV_PATH}'. Upload via POST /api/upload-dataset.")
    severity.load_model(PKL_PATH)
    logger.info("✅ Backend ready")
    yield
    logger.info("■ Backend shutting down")


# ══════════════════════════════════════════════════════════════════════════════
# APP
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(title="Safety AnalystBot API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════════════
# REQUEST MODELS
# ══════════════════════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    message:         str
    conversation_id: Optional[str] = None
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
# HEALTH + STATUS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def api_status():
    return {
        "rag":        rag.get_index_stats(),
        "severity":   {"available": severity.is_loaded()},
        "rebuilding": _rebuilding,
    }


# ══════════════════════════════════════════════════════════════════════════════
# CHAT
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/chat")
def chat(req: ChatRequest):
    global _rebuilding

    if _rebuilding:
        raise HTTPException(503, "Index rebuild in progress. Try again in a moment.")
    if not req.api_key:
        raise HTTPException(400, "api_key is required. Open Settings and add your key.")

    is_new  = req.conversation_id is None
    conv_id = req.conversation_id

    if is_new:
        conv_id = db.create_conversation()["id"]
    else:
        if not db.get_conversation(conv_id):
            raise HTTPException(404, f"Conversation '{conv_id}' not found.")

    try:
        hits, parsed_info = rag.retrieve(req.message, n_results=req.n_results,
                                         filters=req.filters, auto_parse=True)
    except RuntimeError as e:
        raise HTTPException(503, str(e))

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

    note         = f"\n\n[Auto-detected filters: {parsed_info}]" if parsed_info else ""
    user_content = f"Source records:\n\n{_format_context(hits)}{note}\n\n---\n\nQuestion: {req.message}"

    history = db.get_history_for_llm(conv_id, max_turns=8)
    history.append({"role": "user", "content": user_content})

    try:
        answer = llm.call_llm(messages=history, provider=req.provider, api_key=req.api_key,
                               model=req.model, max_tokens=1400, temperature=0.2)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"LLM call failed: {e}")

    sev = severity.predict(req.message)

    db.add_message(conv_id, "user",      req.message)
    db.add_message(conv_id, "assistant", answer, sources=sources, severity=sev)
    if is_new:
        db.auto_title_from_message(conv_id, req.message)

    return {
        "conversation_id":     conv_id,
        "answer":              answer,
        "sources":             sources,
        "severity":            sev,
        "parsed_filters":      parsed_info,
        "is_new_conversation": is_new,
    }


def _format_context(hits: List[dict]) -> str:
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


# ══════════════════════════════════════════════════════════════════════════════
# CONVERSATIONS
# ══════════════════════════════════════════════════════════════════════════════

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


# ══════════════════════════════════════════════════════════════════════════════
# DATASET UPLOAD
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/upload-dataset")
async def upload_dataset(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    global _rebuilding

    if _rebuilding:
        raise HTTPException(409, "A rebuild is already in progress.")
    if not (file.filename or "").endswith(".csv"):
        raise HTTPException(400, "Only .csv files are accepted.")

    import pandas as pd, io
    contents = await file.read()

    try:
        df_check = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(400, f"Could not parse CSV: {e}")

    required = {"report_id", "title", "severity", "what_happened", "why_did_it_happen"}
    missing  = required - set(df_check.columns)
    if missing:
        raise HTTPException(400, f"CSV missing required columns: {missing}. Got: {list(df_check.columns)}")

    save_path = f"uploads/{file.filename}"
    with open(save_path, "wb") as f_out:
        f_out.write(contents)

    background_tasks.add_task(_rebuild_index_task, save_path)
    return {"status": "rebuild_started", "filename": file.filename,
            "rows": len(df_check), "message": "Poll GET /api/status until rebuilding: false."}


def _rebuild_index_task(new_csv_path: str):
    global _rebuilding
    _rebuilding = True
    try:
        shutil.copy(new_csv_path, CSV_PATH)
        rag.initialize(CSV_PATH, CHROMA_PATH, force_rebuild=True)
        logger.info("Index rebuild complete ✅")
    except Exception as e:
        logger.error(f"Index rebuild failed: {e}")
    finally:
        _rebuilding = False


# ══════════════════════════════════════════════════════════════════════════════
# PDF SEVERITY ANALYSIS
# Route:  POST /api/analyze-pdf          ← matches frontend api.ts exactly
# Input:  multipart form, field "file"   ← matches frontend FormData exactly
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/analyze-pdf")
async def analyze_pdf(file: UploadFile = File(...)):
    """
    Accept a PDF → extract text → isolate "What Happened" section →
    run severity .pkl model → return prediction.

    Response shape (matches frontend types exactly):
      extracted_text  : str
      word_count      : int
      what_happened   : str | null
      filename        : str
      severity        : SeverityResult
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted.")

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(400, "PDF too large. Maximum size is 10 MB.")

    # ── Extract text using pypdf (not PyPDF2)
    try:
        import io
        from pypdf import PdfReader

        reader   = PdfReader(io.BytesIO(contents))
        all_text = "\n\n".join(
            page.extract_text() or "" for page in reader.pages
        ).strip()

        if not all_text:
            raise HTTPException(422, "Could not extract text. The PDF may be scanned/image-based.")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, f"PDF parsing failed: {e}")

    # ── Try to isolate "What Happened" section
    what_happened = _extract_section(
        all_text,
        start_markers=["what happened", "what occurred", "incident description"],
        end_markers=  ["what could have happened", "why did it happen",
                       "root cause", "causal factor", "what went well", "lessons"],
    )

    # Use isolated section for prediction if found, otherwise full text (capped)
    text_for_model = (what_happened or all_text)[:2000]
    sev            = severity.predict(text_for_model)

    return {
        "extracted_text": all_text[:2000],
        "word_count":     len(all_text.split()),
        "what_happened":  what_happened[:1000] if what_happened else None,
        "filename":       file.filename,
        "severity":       sev,
    }


def _extract_section(
    text: str,
    start_markers: List[str],
    end_markers:   List[str],
) -> Optional[str]:
    """Pull a named section out of plain text by heading markers. Case-insensitive."""
    lower = text.lower()

    start_pos = None
    for marker in start_markers:
        idx = lower.find(marker)
        if idx != -1:
            newline = text.find("\n", idx)
            start_pos = (newline + 1) if newline != -1 else (idx + len(marker))
            break

    if start_pos is None:
        return None

    end_pos = len(text)
    for marker in end_markers:
        idx = lower.find(marker, start_pos)
        if idx != -1 and idx < end_pos:
            end_pos = idx

    section = text[start_pos:end_pos].strip()
    return section if len(section) > 30 else None


# ══════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/settings/validate-key")
def validate_key(req: ValidateKeyRequest):
    return llm.validate_api_key(req.provider, req.api_key)

@app.get("/api/settings/models")
def get_models():
    return llm.PROVIDER_MODELS

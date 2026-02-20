"""
main.py — Safety AnalystBot backend v2. Python 3.9 compatible.
"""

import os, io, shutil, asyncio, logging
from pathlib import Path
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

import rag, llm, db, severity, notifications

load_dotenv()
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s")
logger = logging.getLogger(__name__)

CHROMA_PATH      = os.getenv("CHROMA_PATH",        "data/chroma_db")
CSV_PATH         = os.getenv("DEFAULT_CSV_PATH",    "data/hackathon_base_table.csv")
PKL_PATH         = os.getenv("SEVERITY_MODEL_PATH", "models/severity_model.pkl")
DB_PATH          = os.getenv("DB_PATH",             "data/conversations.db")
FRONTEND_URL     = os.getenv("FRONTEND_URL",        "http://localhost:3000")
WATCH_FOLDER     = os.getenv("WATCH_FOLDER",        "incidents/incoming")
PROCESSED_FOLDER = "incidents/processed"

_alert_threshold: float = float(os.getenv("ALERT_THRESHOLD", "0.75"))
_rebuilding: bool = False


# ══════════════════════════════════════════════════════════════════════════════
# FOLDER WATCHER
# ══════════════════════════════════════════════════════════════════════════════

async def _watch_folder_loop():
    global _alert_threshold
    Path(WATCH_FOLDER).mkdir(parents=True, exist_ok=True)
    Path(PROCESSED_FOLDER).mkdir(parents=True, exist_ok=True)
    while True:
        await asyncio.sleep(15)
        try:
            for fpath in list(Path(WATCH_FOLDER).iterdir()):
                if not fpath.is_file():
                    continue
                ext = fpath.suffix.lower()
                texts = []
                if ext == ".pdf":
                    try:
                        from pypdf import PdfReader
                        r = PdfReader(str(fpath))
                        t = "\n\n".join(p.extract_text() or "" for p in r.pages).strip()
                        if t: texts.append((t, fpath.name))
                    except Exception as e:
                        logger.error("Watcher PDF error %s: %s", fpath.name, e)
                elif ext == ".csv":
                    try:
                        import pandas as pd
                        df = pd.read_csv(str(fpath))
                        if "what_happened" in df.columns:
                            for _, row in df.iterrows():
                                t = str(row.get("what_happened", "")).strip()
                                if len(t) > 20: texts.append((t, fpath.name))
                    except Exception as e:
                        logger.error("Watcher CSV error %s: %s", fpath.name, e)

                for text, fname in texts:
                    sev = severity.predict(text)
                    notifications.trigger_alert(text, fname, sev, _alert_threshold)
                    logger.info("Watcher processed %s → %s %.0f%%",
                                fname, sev.get("label"), sev.get("confidence", 0)*100)

                shutil.move(str(fpath), str(Path(PROCESSED_FOLDER) / fpath.name))
        except Exception as e:
            logger.error("Watcher loop error: %s", e)


# ══════════════════════════════════════════════════════════════════════════════
# LIFESPAN
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("▶ Starting Safety AnalystBot backend...")
    for d in ["data", "models", "uploads", WATCH_FOLDER, PROCESSED_FOLDER]:
        Path(d).mkdir(parents=True, exist_ok=True)
    db.init_db(DB_PATH)
    if Path(CSV_PATH).exists():
        rag.initialize(CSV_PATH, CHROMA_PATH)
    else:
        logger.warning("Dataset not found at '%s'.", CSV_PATH)
    severity.load_model(PKL_PATH)
    task = asyncio.create_task(_watch_folder_loop())
    logger.info("✅ Backend ready — watching %s every 15s", WATCH_FOLDER)
    yield
    task.cancel()
    logger.info("■ Backend shutting down")


# ══════════════════════════════════════════════════════════════════════════════
# APP
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(title="Safety AnalystBot API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


# ── Request Models ─────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    provider: str = "groq"
    api_key: str = ""
    model: Optional[str] = None
    n_results: int = 8
    filters: Optional[dict] = None

class NewConversationRequest(BaseModel):
    title: str = "New Conversation"

class ValidateKeyRequest(BaseModel):
    provider: str
    api_key: str

class ContactCreateRequest(BaseModel):
    name: str
    email: str
    role: str = "Manager"
    phone: Optional[str] = None

class AlertSettingsRequest(BaseModel):
    threshold: float


# ══════════════════════════════════════════════════════════════════════════════
# HEALTH + STATUS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/status")
def api_status():
    return {"rag": rag.get_index_stats(), "severity": {"available": severity.is_loaded()},
            "rebuilding": _rebuilding}


# ══════════════════════════════════════════════════════════════════════════════
# CHAT
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/chat")
def chat(req: ChatRequest):
    global _rebuilding
    if _rebuilding: raise HTTPException(503, "Index rebuild in progress.")
    if not req.api_key: raise HTTPException(400, "api_key is required.")

    is_new = req.conversation_id is None
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

    sources = [{"record_id": h["metadata"]["report_id"], "title": h["metadata"]["title"],
                "severity": h["metadata"]["severity"], "section": h["metadata"]["section"],
                "location": h["metadata"].get("city") or h["metadata"].get("country") or "Unknown",
                "year": h["metadata"]["year"], "score": h["score"]} for h in hits]

    note = f"\n\n[Auto-detected filters: {parsed_info}]" if parsed_info else ""
    user_content = f"Source records:\n\n{_format_context(hits)}{note}\n\n---\n\nQuestion: {req.message}"
    history = db.get_history_for_llm(conv_id, max_turns=8)
    history.append({"role": "user", "content": user_content})

    try:
        answer = llm.call_llm(messages=history, provider=req.provider, api_key=req.api_key,
                               model=req.model, max_tokens=1400, temperature=0.2)
    except ValueError as e: raise HTTPException(400, str(e))
    except Exception as e:  raise HTTPException(502, f"LLM call failed: {e}")

    sev = severity.predict(req.message)
    db.add_message(conv_id, "user", req.message)
    db.add_message(conv_id, "assistant", answer, sources=sources, severity=sev)
    if is_new: db.auto_title_from_message(conv_id, req.message)

    return {"conversation_id": conv_id, "answer": answer, "sources": sources,
            "severity": sev, "parsed_filters": parsed_info, "is_new_conversation": is_new}


def _format_context(hits: List[dict]) -> str:
    blocks = []
    for i, h in enumerate(hits):
        m = h["metadata"]
        loc = m.get("city") or m.get("country") or "Unknown"
        body = h["text"].split("\n\n", 1)[-1][:600]
        blocks.append(f"SOURCE {i+1} [#{m['report_id']} | {m['severity']} | "
                      f"{loc} | {m['year']} | {m['section']}]\nTitle: {m['title']}\n{body}")
    return "\n\n---\n\n".join(blocks)


# ══════════════════════════════════════════════════════════════════════════════
# CONVERSATIONS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/conversations")
def list_conversations(): return db.list_conversations()

@app.post("/api/conversations")
def create_conversation(req: NewConversationRequest): return db.create_conversation(req.title)

@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: str):
    conv = db.get_conversation(conv_id)
    if not conv: raise HTTPException(404, "Conversation not found.")
    return {**conv, "messages": db.get_messages(conv_id)}

@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str):
    if not db.get_conversation(conv_id): raise HTTPException(404, "Conversation not found.")
    db.delete_conversation(conv_id)
    return {"deleted": True}


# ══════════════════════════════════════════════════════════════════════════════
# DATASET UPLOAD
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/upload-dataset")
async def upload_dataset(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    global _rebuilding
    if _rebuilding: raise HTTPException(409, "Rebuild in progress.")
    if not (file.filename or "").endswith(".csv"): raise HTTPException(400, "Only .csv accepted.")
    import pandas as pd
    contents = await file.read()
    try: df_check = pd.read_csv(io.BytesIO(contents))
    except Exception as e: raise HTTPException(400, f"Could not parse CSV: {e}")
    missing = {"report_id","title","severity","what_happened","why_did_it_happen"} - set(df_check.columns)
    if missing: raise HTTPException(400, f"CSV missing columns: {missing}")
    save_path = f"uploads/{file.filename}"
    with open(save_path, "wb") as f: f.write(contents)
    background_tasks.add_task(_rebuild_index_task, save_path)
    return {"status": "rebuild_started", "filename": file.filename, "rows": len(df_check)}


def _rebuild_index_task(path: str):
    global _rebuilding
    _rebuilding = True
    try:
        shutil.copy(path, CSV_PATH)
        rag.initialize(CSV_PATH, CHROMA_PATH, force_rebuild=True)
        logger.info("Index rebuild complete ✅")
    except Exception as e: logger.error("Rebuild failed: %s", e)
    finally: _rebuilding = False


# ══════════════════════════════════════════════════════════════════════════════
# PDF ANALYSIS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/analyze-pdf")
async def analyze_pdf(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted.")
    contents = await file.read()
    if len(contents) > 10*1024*1024: raise HTTPException(400, "PDF too large. Max 10 MB.")
    try:
        from pypdf import PdfReader
        reader   = PdfReader(io.BytesIO(contents))
        all_text = "\n\n".join(p.extract_text() or "" for p in reader.pages).strip()
        if not all_text: raise HTTPException(422, "No text found — PDF may be image-based.")
    except HTTPException: raise
    except Exception as e: raise HTTPException(422, f"PDF parsing failed: {e}")

    what_happened = _extract_section(all_text,
        ["what happened", "what occurred", "incident description"],
        ["what could have happened", "why did it happen", "root cause", "causal factor", "what went well", "lessons"])
    sev = severity.predict((what_happened or all_text)[:2000])
    return {"extracted_text": all_text[:2000], "word_count": len(all_text.split()),
            "what_happened": what_happened[:1000] if what_happened else None,
            "filename": file.filename, "severity": sev}


def _extract_section(text: str, start_markers: List[str], end_markers: List[str]) -> Optional[str]:
    lower = text.lower()
    start_pos = None
    for m in start_markers:
        idx = lower.find(m)
        if idx != -1:
            nl = text.find("\n", idx)
            start_pos = (nl+1) if nl != -1 else (idx+len(m))
            break
    if start_pos is None: return None
    end_pos = len(text)
    for m in end_markers:
        idx = lower.find(m, start_pos)
        if idx != -1 and idx < end_pos: end_pos = idx
    section = text[start_pos:end_pos].strip()
    return section if len(section) > 30 else None


# ══════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/settings/validate-key")
def validate_key(req: ValidateKeyRequest): return llm.validate_api_key(req.provider, req.api_key)

@app.get("/api/settings/models")
def get_models(): return llm.PROVIDER_MODELS


# ══════════════════════════════════════════════════════════════════════════════
# LIVE REPORTING — CONTACTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/contacts")
def get_contacts(): return db.list_contacts()

@app.post("/api/contacts")
def add_contact(req: ContactCreateRequest):
    return db.create_contact(req.name, req.email, req.role, req.phone)

@app.delete("/api/contacts/{contact_id}")
def remove_contact(contact_id: str):
    db.delete_contact(contact_id)
    return {"deleted": True}


# ══════════════════════════════════════════════════════════════════════════════
# LIVE REPORTING — ALERTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/alerts")
def get_alerts(): return db.list_alerts(limit=50)

@app.post("/api/alerts/test")
def test_alert():
    test_text = ("TEST — Simulated high-severity incident. A worker was exposed to "
                 "a chemical release without proper PPE during isolation procedure failure.")
    sev = severity.predict(test_text)
    sev["label"]      = "High Severity"
    sev["confidence"] = _alert_threshold + 0.01
    sev["available"]  = True
    return notifications.trigger_alert(test_text, "test_alert.pdf", sev, _alert_threshold)

@app.get("/api/alerts/settings")
def get_alert_settings(): return {"threshold": _alert_threshold}

@app.post("/api/alerts/settings")
def update_alert_settings(req: AlertSettingsRequest):
    global _alert_threshold
    if not 0.0 <= req.threshold <= 1.0:
        raise HTTPException(400, "Threshold must be 0.0–1.0")
    _alert_threshold = req.threshold
    logger.info("Alert threshold → %.2f", _alert_threshold)
    return {"threshold": _alert_threshold}


# ══════════════════════════════════════════════════════════════════════════════
# MANUAL INCIDENT UPLOAD (from Incident Tracker UI)
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/incidents/upload")
async def upload_incident(file: UploadFile = File(...)):
    """
    Accept a PDF or CSV from the Incident Tracker UI.
    Scores it immediately and triggers alerts if above threshold.
    Returns the severity result so the UI can show instant feedback.
    """
    fname = file.filename or ""
    ext   = fname.lower().rsplit(".", 1)[-1] if "." in fname else ""

    if ext not in ("pdf", "csv"):
        raise HTTPException(400, "Only PDF or CSV files are accepted.")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(400, "File too large. Max 20 MB.")

    incident_texts: List[str] = []

    if ext == "pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(contents))
            text   = "\n\n".join(p.extract_text() or "" for p in reader.pages).strip()
            if not text:
                raise HTTPException(422, "No text found — PDF may be image-based.")
            incident_texts.append(text)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(422, f"PDF parsing failed: {e}")

    elif ext == "csv":
        try:
            import pandas as pd
            df = pd.read_csv(io.BytesIO(contents))
            if "what_happened" not in df.columns:
                raise HTTPException(400, "CSV must have a 'what_happened' column.")
            for _, row in df.iterrows():
                t = str(row.get("what_happened", "")).strip()
                if len(t) > 20:
                    incident_texts.append(t)
            if not incident_texts:
                raise HTTPException(422, "No usable rows found in CSV.")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(422, f"CSV parsing failed: {e}")

    # Score the first / primary text block
    primary_text = incident_texts[0]
    sev          = severity.predict(primary_text[:2000])

    # Trigger alert pipeline (handles threshold check + email + logging)
    result = notifications.trigger_alert(
        incident_text=primary_text,
        filename=fname,
        severity_result=sev,
        threshold=_alert_threshold,
    )

    # If CSV had multiple rows, process remaining ones in background
    if len(incident_texts) > 1:
        for extra_text in incident_texts[1:]:
            extra_sev = severity.predict(extra_text[:2000])
            notifications.trigger_alert(extra_text, fname, extra_sev, _alert_threshold)

    return {
        "filename":       fname,
        "severity_label": sev.get("label", "Unknown"),
        "confidence":     sev.get("confidence", 0.0),
        "triggered":      result["triggered"],
        "contacts_notified": result["contacts_notified"],
        "alert_id":       result["alert_id"],
    }

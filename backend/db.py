"""
db.py — SQLite storage. Python 3.9 compatible.
Tables: conversations, messages, alert_contacts, alert_log
"""

import sqlite3, json, uuid, logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)
_DB_PATH = "data/conversations.db"


def init_db(db_path: str = "data/conversations.db"):
    global _DB_PATH
    _DB_PATH = db_path
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New Conversation',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
                role TEXT NOT NULL, content TEXT NOT NULL,
                sources TEXT, severity TEXT, created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

            CREATE TABLE IF NOT EXISTS alert_contacts (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'Manager', phone TEXT,
                is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS alert_log (
                id TEXT PRIMARY KEY, incident_text TEXT NOT NULL,
                filename TEXT, severity_label TEXT NOT NULL,
                confidence REAL NOT NULL, threshold_used REAL NOT NULL,
                contacts_notified TEXT NOT NULL DEFAULT '[]',
                triggered_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
            );
            CREATE INDEX IF NOT EXISTS idx_alert_log_time ON alert_log(triggered_at DESC);
        """)
    logger.info("Database ready at %s ✅", db_path)


def _conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Conversations ──────────────────────────────────────────────────────────────

def create_conversation(title: str = "New Conversation") -> Dict[str, Any]:
    now, cid = _now(), str(uuid.uuid4())
    with _conn() as conn:
        conn.execute("INSERT INTO conversations (id,title,created_at,updated_at,message_count) VALUES (?,?,?,?,0)",
                     (cid, title, now, now))
    return {"id": cid, "title": title, "created_at": now, "updated_at": now, "message_count": 0}

def list_conversations() -> List[Dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM conversations ORDER BY updated_at DESC").fetchall()]

def get_conversation(conv_id: str) -> Optional[Dict[str, Any]]:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM conversations WHERE id=?", (conv_id,)).fetchone()
    return dict(row) if row else None

def update_conversation_title(conv_id: str, title: str):
    with _conn() as conn:
        conn.execute("UPDATE conversations SET title=?,updated_at=? WHERE id=?", (title[:80], _now(), conv_id))

def delete_conversation(conv_id: str):
    with _conn() as conn:
        conn.execute("DELETE FROM messages WHERE conversation_id=?", (conv_id,))
        conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))

def auto_title_from_message(conv_id: str, user_message: str):
    t = user_message.strip()
    update_conversation_title(conv_id, t[:57]+"..." if len(t) > 60 else t)


# ── Messages ───────────────────────────────────────────────────────────────────

def add_message(conv_id: str, role: str, content: str,
                sources: Optional[list] = None, severity: Optional[dict] = None) -> Dict[str, Any]:
    now, mid = _now(), str(uuid.uuid4())
    with _conn() as conn:
        conn.execute(
            "INSERT INTO messages (id,conversation_id,role,content,sources,severity,created_at) VALUES (?,?,?,?,?,?,?)",
            (mid, conv_id, role, content,
             json.dumps(sources) if sources else None,
             json.dumps(severity) if severity else None, now))
        conn.execute("UPDATE conversations SET updated_at=?,message_count=message_count+1 WHERE id=?", (now, conv_id))
    return {"id": mid, "conversation_id": conv_id, "role": role, "content": content,
            "sources": sources, "severity": severity, "created_at": now}

def get_messages(conv_id: str) -> List[Dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC", (conv_id,)).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["sources"]  = json.loads(d["sources"])  if d["sources"]  else []
        d["severity"] = json.loads(d["severity"]) if d["severity"] else None
        result.append(d)
    return result

def get_history_for_llm(conv_id: str, max_turns: int = 8) -> List[Dict[str, Any]]:
    return [{"role": m["role"], "content": m["content"]} for m in get_messages(conv_id)[-(max_turns*2):]]


# ── Alert Contacts ─────────────────────────────────────────────────────────────

def create_contact(name: str, email: str, role: str = "Manager", phone: Optional[str] = None) -> Dict[str, Any]:
    now, cid = _now(), str(uuid.uuid4())
    with _conn() as conn:
        conn.execute("INSERT INTO alert_contacts (id,name,email,role,phone,is_active,created_at) VALUES (?,?,?,?,?,1,?)",
                     (cid, name, email, role, phone, now))
    return {"id": cid, "name": name, "email": email, "role": role, "phone": phone, "is_active": True, "created_at": now}

def list_contacts() -> List[Dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM alert_contacts WHERE is_active=1 ORDER BY created_at ASC").fetchall()]

def delete_contact(contact_id: str):
    with _conn() as conn:
        conn.execute("UPDATE alert_contacts SET is_active=0 WHERE id=?", (contact_id,))


# ── Alert Log ──────────────────────────────────────────────────────────────────

def log_alert(incident_text: str, filename: Optional[str], severity_label: str,
              confidence: float, threshold_used: float, contacts_notified: List[str],
              status: str = "pending") -> str:
    now, aid = _now(), str(uuid.uuid4())
    with _conn() as conn:
        conn.execute(
            "INSERT INTO alert_log (id,incident_text,filename,severity_label,confidence,"
            "threshold_used,contacts_notified,triggered_at,status) VALUES (?,?,?,?,?,?,?,?,?)",
            (aid, incident_text[:2000], filename, severity_label, confidence,
             threshold_used, json.dumps(contacts_notified), now, status))
    return aid

def list_alerts(limit: int = 50) -> List[Dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM alert_log ORDER BY triggered_at DESC LIMIT ?", (limit,)).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["contacts_notified"] = json.loads(d["contacts_notified"])
        result.append(d)
    return result

"""
db.py
-----
SQLite storage for conversations and messages.
No ORM — plain sqlite3 for simplicity and zero extra dependencies.

Schema:
  conversations  — one row per chat thread
  messages       — all messages, linked to a conversation
"""

import sqlite3
import json
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

logger = logging.getLogger(__name__)

# Module-level path (set by init_db)
_DB_PATH = "data/conversations.db"


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP
# ══════════════════════════════════════════════════════════════════════════════

def init_db(db_path: str = "data/conversations.db"):
    """Create tables if they don't exist. Call once at server startup."""
    global _DB_PATH
    _DB_PATH = db_path
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id            TEXT PRIMARY KEY,
                title         TEXT NOT NULL DEFAULT 'New Conversation',
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS messages (
                id              TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role            TEXT NOT NULL,
                content         TEXT NOT NULL,
                sources         TEXT,
                severity        TEXT,
                created_at      TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conv
                ON messages(conversation_id, created_at);
        """)

    logger.info(f"Database ready at {db_path} ✅")


def _conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ══════════════════════════════════════════════════════════════════════════════
# CONVERSATIONS
# ══════════════════════════════════════════════════════════════════════════════

def create_conversation(title: str = "New Conversation") -> dict:
    now = _now()
    cid = str(uuid.uuid4())
    with _conn() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at, message_count) "
            "VALUES (?, ?, ?, ?, 0)",
            (cid, title, now, now),
        )
    return {"id": cid, "title": title, "created_at": now,
            "updated_at": now, "message_count": 0}


def list_conversations() -> List[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM conversations ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_conversation(conv_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conv_id,)
        ).fetchone()
    return dict(row) if row else None


def update_conversation_title(conv_id: str, title: str):
    with _conn() as conn:
        conn.execute(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
            (title[:80], _now(), conv_id),
        )


def delete_conversation(conv_id: str):
    with _conn() as conn:
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))


# ══════════════════════════════════════════════════════════════════════════════
# MESSAGES
# ══════════════════════════════════════════════════════════════════════════════

def add_message(
    conv_id:  str,
    role:     str,
    content:  str,
    sources:  Optional[list] = None,
    severity: Optional[dict] = None,
) -> dict:
    now = _now()
    mid = str(uuid.uuid4())

    with _conn() as conn:
        conn.execute(
            "INSERT INTO messages "
            "(id, conversation_id, role, content, sources, severity, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                mid, conv_id, role, content,
                json.dumps(sources)  if sources  else None,
                json.dumps(severity) if severity else None,
                now,
            ),
        )
        conn.execute(
            "UPDATE conversations "
            "SET updated_at = ?, message_count = message_count + 1 "
            "WHERE id = ?",
            (now, conv_id),
        )

    return {
        "id": mid, "conversation_id": conv_id, "role": role,
        "content": content, "sources": sources, "severity": severity,
        "created_at": now,
    }


def get_messages(conv_id: str) -> List[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM messages "
            "WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,),
        ).fetchall()

    result = []
    for r in rows:
        d = dict(r)
        d["sources"]  = json.loads(d["sources"])  if d["sources"]  else []
        d["severity"] = json.loads(d["severity"]) if d["severity"] else None
        result.append(d)
    return result


def get_history_for_llm(conv_id: str, max_turns: int = 8) -> List[dict]:
    """
    Return the last N turn-pairs as [{role, content}] for the LLM.
    Strips sources/severity — LLM only needs role + content.
    """
    messages = get_messages(conv_id)
    recent   = messages[-(max_turns * 2):]
    return [{"role": m["role"], "content": m["content"]} for m in recent]


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def auto_title_from_message(conv_id: str, user_message: str):
    """Set conversation title from first user message (truncated to 60 chars)."""
    title = user_message.strip()
    if len(title) > 60:
        title = title[:57] + "..."
    update_conversation_title(conv_id, title)

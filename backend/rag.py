"""
rag.py
------
Full RAG pipeline: CSV → clean → chunk → embed → ChromaDB → retrieve.

Improvements over v1:
  1. RERANKING  — after semantic retrieval, scores are boosted by
                  keyword overlap between query and chunk text.
                  This prevents high-scoring chunks that match the
                  embedding but miss the actual keywords from dominating.
  2. DEDUP      — chunks from the same record are deduplicated so the
                  LLM sees diverse records, not 4 chunks from record #42.
  3. WIDER NET  — we retrieve 3x n_results then rerank+dedup down to
                  n_results. More candidates = better final selection.
  4. SMART FALLBACK — if a filtered query returns < 3 hits we blend
                  filtered + unfiltered results instead of dropping
                  the filter entirely.
  5. SECTION BOOST — "What Happened" chunks get a slight score boost
                  for factual queries; "Lessons" chunks for prevention
                  queries. Gives the LLM better-matched content.
  6. Python 3.9 — all type hints use typing.Optional/List/Tuple/Dict.
"""

import re
import logging
from pathlib import Path
from typing import Optional, List, Tuple, Dict

import pandas as pd
import numpy as np
import chromadb
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


# ── Constants ──────────────────────────────────────────────────────────────────

SECTIONS = [
    ("What Happened",        "what_happened"),
    ("Root Cause",           "why_did_it_happen"),
    ("Causal Factors",       "causal_factors"),
    ("Lessons & Prevention", "lessons_to_prevent"),
]

RISK_MAP = {1: "High", 2: "Medium", 3: "Low"}

LOCATION_MAP = {
    "vancouver":         {"city": "Vancouver"},
    "trinidad tobago":   {"city": "Trinidad Tobago"},
    "trinidad":          {"city": "Trinidad Tobago"},
    "tobago":            {"city": "Trinidad Tobago"},
    "working from home": {"city": "Working Home"},
    "work from home":    {"city": "Working Home"},
    "wfh":               {"city": "Working Home"},
    "remote":            {"city": "Working Home"},
    "brussels":          {"city": "Brussels"},
    "egypt":             {"country": "Egypt"},
    "new zealand":       {"country": "New Zealand"},
    "chile":             {"country": "Chile"},
    "usa":               {"country": "Usa"},
    "united states":     {"country": "Usa"},
    "canada":            {"country": "Canada"},
}

SEVERITY_MAP = {
    "major":                   {"severity": "Major"},
    "serious":                 {"severity": "Serious"},
    "potentially significant": {"severity": "Potentially Significant"},
    "near miss":               {"severity": "Near Miss"},
    "minor":                   {"severity": "Minor"},
    "high risk":               {"is_high_risk": 1},
    "high-risk":               {"is_high_risk": 1},
}

DOMAIN_EXPANSIONS = [
    (["incident", "accident", "event", "what happened"],
     "safety incident near miss accident event occurrence"),
    (["cause", "why", "root", "reason"],
     "root cause failure reason contributing factor"),
    (["prevent", "lesson", "avoid", "recommendation", "action"],
     "lessons learned prevention corrective action recommendation"),
    (["contractor", "worker", "employee", "staff", "crew"],
     "contractor worker employee personnel crew technician"),
    (["ai", "machine learning", "model", "algorithm", "predictive"],
     "AI artificial intelligence machine learning predictive model failure"),
    (["cyber", "hack", "breach", "digital", "unauthorized"],
     "cybersecurity unauthorized access breach digital intrusion"),
    (["chemical", "vapor", "spill", "release", "exposure"],
     "chemical vapor release spill exposure toxic hazardous"),
    (["confined", "vessel", "tank", "entry", "space"],
     "confined space entry vessel permit work atmosphere"),
    (["valve", "isolation", "pressure", "line", "pipe", "fitting"],
     "valve isolation pressure line pipe fitting maintenance"),
    (["fall", "electric", "shock", "arc", "height", "ladder"],
     "fall height electrical shock arc flash energy"),
    (["trend", "change", "increase", "grow", "pattern", "over time"],
     "trend change increase growth pattern year over year comparison"),
    (["compare", "difference", "versus", "vs", "between", "before", "after"],
     "compare contrast difference versus comparison analysis period"),
    (["pre-shift", "briefing", "brief", "morning", "start of shift", "today"],
     "pre-shift briefing safety hazard watch for alert awareness"),
    (["pattern", "repeat", "recurring", "common", "frequent", "again"],
     "recurring pattern repeat systemic common frequent multiple incidents"),
    (["worst", "severe", "serious", "critical", "major", "priority"],
     "major serious critical high risk severe priority escalation"),
]

# Keywords that favour "What Happened" section
FACTUAL_KEYWORDS = {"what", "happened", "describe", "explain", "detail",
                    "incident", "occurred", "event", "accident"}

# Keywords that favour "Lessons & Prevention" section
LESSON_KEYWORDS  = {"prevent", "lesson", "recommendation", "avoid", "action",
                    "corrective", "improve", "future", "should", "next time"}

YEAR_RE = re.compile(r"\b(201\d|202\d)\b")


# ── Module singletons ──────────────────────────────────────────────────────────

_embedder:   Optional[SentenceTransformer] = None
_collection = None
_df:         Optional[pd.DataFrame] = None


# ══════════════════════════════════════════════════════════════════════════════
# DATA CLEANING
# ══════════════════════════════════════════════════════════════════════════════

def _infer_country(row) -> str:
    if pd.notna(row["country"]) and str(row["country"]).strip():
        return str(row["country"]).strip().title()
    city = str(row.get("city_clean", "")).lower()
    if "vancouver" in city or "working home" in city:
        return "Canada"
    return "Unknown"


def load_and_clean(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)

    df["risk_label"]     = df["risk"].map(RISK_MAP).fillna("Unknown")
    df["title_clean"]    = df["title"].str.title()
    df["severity_clean"] = df["severity"].str.title()
    df["category_clean"] = df["category"].str.title()
    df["year"]           = df["year"].fillna(df["year"].median()).astype(int)
    df["city_clean"]     = df["city"].fillna("").str.strip().str.title()
    df["country_clean"]  = df.apply(_infer_country, axis=1)
    df["classification"] = df["primary_classification"].fillna("").str.title()

    df["injury_clean"] = df["injury_category"].apply(
        lambda x: "Medical Treatment" if len(str(x)) > 60 else str(x).title()
    )

    df["is_major"]     = (df["severity"] == "major").astype(int)
    df["is_high_risk"] = (df["risk"] == 1).astype(int)
    df["has_injury"]   = (~df["injury_clean"].isin(["Injury"])).astype(int)
    df["is_near_miss"] = (df["severity"] == "near miss").astype(int)
    df["location_label"] = df.apply(
        lambda r: r["city_clean"] if r["city_clean"] else r["country_clean"], axis=1
    )

    text_cols = [
        "what_happened", "what_could_have_happened", "why_did_it_happen",
        "causal_factors", "what_went_well", "lessons_to_prevent", "actions",
    ]
    for col in text_cols:
        df[col] = df[col].fillna("")

    logger.info("Loaded and cleaned %d records from %s", len(df), csv_path)
    return df


# ══════════════════════════════════════════════════════════════════════════════
# CHUNKING
# ══════════════════════════════════════════════════════════════════════════════

def _build_location(row) -> str:
    city    = str(row["city_clean"]).strip()
    country = str(row["country_clean"]).strip()
    if city and city not in ("", "Unknown", "Nan"):
        return f"{city}, {country}" if country not in ("Unknown", "") else city
    return country if country != "Unknown" else "Unknown Location"


def build_chunks(df: pd.DataFrame) -> Tuple[list, list, list]:
    ids, texts, metas = [], [], []

    for _, row in df.iterrows():
        loc = _build_location(row)
        header = (
            f"[Record #{row['report_id']} | {row['severity_clean']} | "
            f"{row['category_clean']} | {loc} | {row['year']} | Risk:{row['risk_label']}]"
        )

        for section_label, col in SECTIONS:
            text = str(row[col]).strip()
            if len(text) < 20:
                continue

            chunk_text = (
                f"{header}\n"
                f"Title: {row['title_clean']}\n"
                f"Location: {loc}\n"
                f"Section: {section_label}\n\n"
                f"{text}"
            )

            ids.append(f"rec{row['report_id']}_{col}")
            texts.append(chunk_text)
            metas.append({
                "report_id":    str(row["report_id"]),
                "title":        str(row["title_clean"]),
                "severity":     str(row["severity_clean"]),
                "category":     str(row["category_clean"]),
                "country":      str(row["country_clean"]),
                "city":         str(row["city_clean"]),
                "location":     loc,
                "year":         str(row["year"]),
                "risk":         str(row["risk_label"]),
                "section":      section_label,
                "is_major":     int(row["is_major"]),
                "is_high_risk": int(row["is_high_risk"]),
                "has_injury":   int(row["has_injury"]),
                "is_near_miss": int(row["is_near_miss"]),
                "injury":       str(row["injury_clean"]),
                "classification": str(row["classification"]),
            })

    logger.info("Built %d chunks from %d records", len(ids), len(df))
    return ids, texts, metas


# ══════════════════════════════════════════════════════════════════════════════
# INDEXING
# ══════════════════════════════════════════════════════════════════════════════

def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        logger.info("Loading sentence-transformer (all-MiniLM-L6-v2)...")
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded ✅")
    return _embedder


def build_index(df: pd.DataFrame, chroma_path: str, force_rebuild: bool = False):
    global _collection

    Path(chroma_path).mkdir(parents=True, exist_ok=True)
    client   = chromadb.PersistentClient(path=chroma_path)
    existing = [c.name for c in client.list_collections()]

    if "safety_incidents" in existing and not force_rebuild:
        _collection = client.get_collection("safety_incidents")
        if _collection.count() > 0:
            logger.info("Loaded existing index: %d chunks ✅", _collection.count())
            return _collection
        logger.info("Existing collection empty — rebuilding...")

    try:
        client.delete_collection("safety_incidents")
    except Exception:
        pass

    _collection = client.create_collection(
        "safety_incidents",
        metadata={"hnsw:space": "cosine"},
    )

    ids, texts, metas = build_chunks(df)
    embedder = _get_embedder()

    logger.info("Embedding %d chunks (~90s first time)...", len(texts))
    embeddings = embedder.encode(
        texts, batch_size=32, show_progress_bar=True, convert_to_numpy=True
    )

    for i in range(0, len(ids), 200):
        _collection.add(
            ids=        ids[i:i+200],
            documents=  texts[i:i+200],
            embeddings= embeddings[i:i+200].tolist(),
            metadatas=  metas[i:i+200],
        )

    logger.info("Indexed %d chunks ✅", _collection.count())
    return _collection


# ══════════════════════════════════════════════════════════════════════════════
# QUERY PARSER
# ══════════════════════════════════════════════════════════════════════════════

def parse_query(query: str) -> Tuple[str, Optional[dict], dict]:
    q = query.lower()
    filters_list = []
    extracted: dict = {}

    is_comparison = any(kw in q for kw in [
        "compare", "versus", " vs ", "difference", "before", "after",
        "then look", "changed", "trend", "between",
    ])

    if not is_comparison:
        for phrase, fv in LOCATION_MAP.items():
            if phrase in q:
                filters_list.append(fv)
                extracted["location"] = phrase.title()
                break
        for phrase, fv in SEVERITY_MAP.items():
            if phrase in q:
                filters_list.append(fv)
                extracted["severity"] = phrase.title()
                break

    years = YEAR_RE.findall(q)
    if years:
        extracted["years_mentioned"] = sorted(set(int(y) for y in years))
        if len(years) == 1 and not is_comparison:
            filters_list.append({"year": years[0]})
            extracted["year"] = years[0]

    final_filter: Optional[dict] = None
    if len(filters_list) == 1:
        final_filter = filters_list[0]
    elif len(filters_list) > 1:
        final_filter = {"$and": filters_list}

    expansions = []
    for keywords, expansion in DOMAIN_EXPANSIONS:
        if any(kw in q for kw in keywords):
            expansions.append(expansion)
    expanded = query + (" " + " ".join(set(expansions)) if expansions else "")

    return expanded, final_filter, extracted


# ══════════════════════════════════════════════════════════════════════════════
# RERANKER
# ══════════════════════════════════════════════════════════════════════════════

def _keyword_overlap_score(query_words: set, chunk_text: str) -> float:
    """
    Fraction of unique query words that appear in the chunk text.
    Returns 0.0–1.0. Stops on very short queries.
    """
    if len(query_words) < 2:
        return 0.0
    chunk_lower = chunk_text.lower()
    hits = sum(1 for w in query_words if w in chunk_lower)
    return hits / len(query_words)


def _section_preference_boost(query_lower: str, section: str) -> float:
    """
    Small boost (+0.05) when the query intent matches the section type.
    Factual queries → What Happened. Prevention queries → Lessons.
    """
    q_words = set(query_lower.split())
    if section == "What Happened" and q_words & FACTUAL_KEYWORDS:
        return 0.05
    if section == "Lessons & Prevention" and q_words & LESSON_KEYWORDS:
        return 0.05
    return 0.0


def _rerank_and_dedup(
    hits: List[dict],
    query: str,
    n_results: int,
) -> List[dict]:
    """
    1. Boost semantic score with keyword overlap (weight: 30%)
    2. Add section preference boost
    3. Deduplicate: keep only the best-scoring chunk per record
    4. Return top n_results
    """
    q_lower = query.lower()
    # Extract meaningful words (skip stopwords and short tokens)
    stop = {"the", "a", "an", "is", "in", "of", "to", "and", "for",
            "on", "at", "by", "with", "this", "that", "are", "was",
            "were", "be", "been", "have", "has", "had", "do", "did",
            "what", "how", "why", "when", "where", "which", "who"}
    q_words = {w for w in re.findall(r"[a-z]+", q_lower) if w not in stop and len(w) > 2}

    scored = []
    for h in hits:
        sem_score     = h["score"]                                          # 0–1 cosine sim
        kw_score      = _keyword_overlap_score(q_words, h["text"])          # 0–1
        section_boost = _section_preference_boost(q_lower, h["metadata"].get("section", ""))
        final_score   = (0.70 * sem_score) + (0.30 * kw_score) + section_boost
        scored.append({**h, "score": round(final_score, 4)})

    # Dedup: keep best chunk per record_id
    seen_records: Dict[str, dict] = {}
    for h in sorted(scored, key=lambda x: x["score"], reverse=True):
        rid = h["metadata"]["report_id"]
        if rid not in seen_records:
            seen_records[rid] = h

    # Return top n_results by score
    deduped = sorted(seen_records.values(), key=lambda x: x["score"], reverse=True)
    return deduped[:n_results]


# ══════════════════════════════════════════════════════════════════════════════
# RETRIEVER
# ══════════════════════════════════════════════════════════════════════════════

def retrieve(
    query: str,
    n_results: int = 8,
    filters: Optional[dict] = None,
    auto_parse: bool = True,
) -> Tuple[List[dict], dict]:
    """
    Retrieve the most relevant chunks for a query.

    Pipeline:
      1. Parse query → expand + extract filters
      2. Embed expanded query
      3. Retrieve 3× n_results candidates from ChromaDB (wider net)
      4. If filter returns < 3 hits, blend with unfiltered results
      5. Rerank by keyword overlap + section preference
      6. Deduplicate to one chunk per record
      7. Return top n_results

    Returns (hits, parsed_info)
    Each hit: {text, metadata, score}
    """
    global _collection

    if _collection is None:
        raise RuntimeError("RAG index not initialized. Call initialize() first.")

    parsed_info: dict = {}
    candidates_n = min(n_results * 3, 50)   # wider net, capped at 50

    if auto_parse:
        expanded, auto_filters, parsed_info = parse_query(query)
        if filters is None:
            filters = auto_filters
        query_vec = _get_embedder().encode([expanded]).tolist()
    else:
        expanded  = query
        query_vec = _get_embedder().encode([query]).tolist()

    def _do_query(where=None, n=candidates_n):
        kw = dict(
            query_embeddings=query_vec,
            n_results=n,
            include=["documents", "metadatas", "distances"],
        )
        if where:
            kw["where"] = where
        return _collection.query(**kw)

    def _parse_results(res) -> List[dict]:
        return [
            {"text": doc, "metadata": meta, "score": round(1 - dist, 4)}
            for doc, meta, dist in zip(
                res["documents"][0],
                res["metadatas"][0],
                res["distances"][0],
            )
        ]

    # ── Retrieve with filter
    filtered_hits: List[dict] = []
    if filters:
        try:
            res = _do_query(filters)
            if res["documents"][0]:
                filtered_hits = _parse_results(res)
        except Exception:
            logger.warning("Filtered query failed — using unfiltered only")

    # ── If filter gave < 3 results, blend in unfiltered
    if len(filtered_hits) < 3:
        try:
            res_unfiltered = _do_query(None)
            unfiltered_hits = _parse_results(res_unfiltered)
        except Exception:
            unfiltered_hits = []

        if filtered_hits:
            # Blend: filtered hits first (priority), then fill with unfiltered
            filtered_ids = {h["metadata"]["report_id"] for h in filtered_hits}
            extra = [h for h in unfiltered_hits if h["metadata"]["report_id"] not in filtered_ids]
            candidates = filtered_hits + extra[:candidates_n - len(filtered_hits)]
            logger.info("Blended %d filtered + %d unfiltered candidates", len(filtered_hits), len(extra))
        else:
            candidates = unfiltered_hits
    else:
        candidates = filtered_hits

    if not candidates:
        logger.warning("No candidates returned — index may be empty")
        return [], parsed_info

    # ── Rerank + dedup → final top n_results
    final_hits = _rerank_and_dedup(candidates, expanded, n_results)
    logger.info("retrieve: %d candidates → %d final hits", len(candidates), len(final_hits))

    return final_hits, parsed_info


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP + PUBLIC HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def initialize(csv_path: str, chroma_path: str, force_rebuild: bool = False):
    global _df
    _df = load_and_clean(csv_path)
    build_index(_df, chroma_path, force_rebuild=force_rebuild)
    logger.info("RAG pipeline initialized ✅")
    return _df


def get_df() -> pd.DataFrame:
    if _df is None:
        raise RuntimeError("DataFrame not loaded. Call initialize() first.")
    return _df


def get_index_stats() -> dict:
    if _collection is None:
        return {"status": "not_initialized", "chunks": 0, "records": 0}
    df = get_df()
    return {
        "status":        "ready",
        "chunks":        _collection.count(),
        "records":       len(df),
        "years":         sorted([int(y) for y in df["year"].unique().tolist()]),
        "severity_dist": df["severity_clean"].value_counts().to_dict(),
    }

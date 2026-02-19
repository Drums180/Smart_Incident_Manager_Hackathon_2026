"""
rag.py
------
Full RAG pipeline: CSV → clean → chunk → embed → ChromaDB → retrieve.

Ported directly from Challenge2_SmartRAG.ipynb (the working notebook).
Uses ChromaDB in persistent mode so the index survives restarts.
All state lives in module-level singletons loaded once at startup.
"""

import re
import logging
from pathlib import Path
from typing import Optional

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
]

YEAR_RE = re.compile(r"\b(201\d|202\d)\b")


# ── Module singletons ──────────────────────────────────────────────────────────

_embedder:   Optional[SentenceTransformer] = None
_collection = None
_df:         Optional[pd.DataFrame] = None


# ══════════════════════════════════════════════════════════════════════════════
# DATA CLEANING  (identical logic to notebook Cell 4)
# ══════════════════════════════════════════════════════════════════════════════

def _infer_country(row) -> str:
    if pd.notna(row["country"]) and str(row["country"]).strip():
        return str(row["country"]).strip().title()
    city = str(row.get("city_clean", "")).lower()
    if "vancouver" in city or "working home" in city:
        return "Canada"
    return "Unknown"


def load_and_clean(csv_path: str) -> pd.DataFrame:
    """Load CSV and apply all cleaning steps. Mirrors notebook Cell 4."""
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

    logger.info(f"Loaded and cleaned {len(df)} records from {csv_path}")
    return df


# ══════════════════════════════════════════════════════════════════════════════
# CHUNKING  (mirrors notebook Cell 5)
# ══════════════════════════════════════════════════════════════════════════════

def _build_location(row) -> str:
    city    = str(row["city_clean"]).strip()
    country = str(row["country_clean"]).strip()
    if city and city not in ("", "Unknown", "Nan"):
        return f"{city}, {country}" if country not in ("Unknown", "") else city
    return country if country != "Unknown" else "Unknown Location"


def build_chunks(df: pd.DataFrame) -> tuple[list, list, list]:
    """
    Convert DataFrame → (ids, texts, metadatas) ready for ChromaDB.
    Each record produces up to 4 chunks (one per narrative section).
    Every chunk carries its full metadata in the header text so the LLM
    always knows which record it came from.
    """
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

    logger.info(f"Built {len(ids)} chunks from {len(df)} records")
    return ids, texts, metas


# ══════════════════════════════════════════════════════════════════════════════
# INDEXING  (persistent ChromaDB)
# ══════════════════════════════════════════════════════════════════════════════

def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        logger.info("Loading sentence-transformer model (all-MiniLM-L6-v2)...")
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded ✅")
    return _embedder


def build_index(df: pd.DataFrame, chroma_path: str, force_rebuild: bool = False):
    """
    Build or load ChromaDB index.
    - If index exists on disk and force_rebuild=False → load it (fast, ~2s)
    - Otherwise → embed all chunks and write to disk (~90s first time)
    """
    global _collection

    Path(chroma_path).mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=chroma_path)

    existing = [c.name for c in client.list_collections()]

    if "safety_incidents" in existing and not force_rebuild:
        _collection = client.get_collection("safety_incidents")
        if _collection.count() > 0:
            logger.info(f"Loaded existing index: {_collection.count()} chunks ✅")
            return _collection
        # Collection exists but empty — rebuild
        logger.info("Existing collection is empty, rebuilding...")

    # Fresh build
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

    logger.info(f"Embedding {len(texts)} chunks (this takes ~90s first time)...")
    embeddings = embedder.encode(
        texts, batch_size=32, show_progress_bar=True, convert_to_numpy=True
    )

    # Batch insert (ChromaDB has a per-batch limit)
    for i in range(0, len(ids), 200):
        _collection.add(
            ids=       ids[i:i+200],
            documents= texts[i:i+200],
            embeddings=embeddings[i:i+200].tolist(),
            metadatas= metas[i:i+200],
        )

    logger.info(f"Indexed {_collection.count()} chunks ✅")
    return _collection


# ══════════════════════════════════════════════════════════════════════════════
# QUERY PARSER  (mirrors notebook Cell 7, upgraded for multi-year)
# ══════════════════════════════════════════════════════════════════════════════

def parse_query(query: str) -> tuple[str, Optional[dict], dict]:
    """
    1. Extract location / severity / year → ChromaDB metadata filter
    2. Expand query with domain synonyms → better embedding recall

    Returns (expanded_query, chroma_filter_or_None, extracted_info_dict)

    Key design: if the query mentions multiple years (comparison intent),
    we skip year filtering so retrieval covers the full range.
    """
    q = query.lower()
    filters_list = []
    extracted: dict = {}

    # Comparison intent — don't over-filter
    is_comparison = any(kw in q for kw in [
        "compare", "versus", " vs ", "difference", "before", "after",
        "then look", "changed", "trend", "between",
    ])

    # Location
    if not is_comparison:
        for phrase, fv in LOCATION_MAP.items():
            if phrase in q:
                filters_list.append(fv)
                extracted["location"] = phrase.title()
                break

        # Severity
        for phrase, fv in SEVERITY_MAP.items():
            if phrase in q:
                filters_list.append(fv)
                extracted["severity"] = phrase.title()
                break

    # Year(s)
    years = YEAR_RE.findall(q)
    if years:
        extracted["years_mentioned"] = sorted(set(int(y) for y in years))
        if len(years) == 1 and not is_comparison:
            filters_list.append({"year": years[0]})
            extracted["year"] = years[0]

    # Build filter
    final_filter: Optional[dict] = None
    if len(filters_list) == 1:
        final_filter = filters_list[0]
    elif len(filters_list) > 1:
        final_filter = {"$and": filters_list}

    # Query expansion
    expansions = []
    for keywords, expansion in DOMAIN_EXPANSIONS:
        if any(kw in q for kw in keywords):
            expansions.append(expansion)
    expanded = query + (" " + " ".join(set(expansions)) if expansions else "")

    return expanded, final_filter, extracted


# ══════════════════════════════════════════════════════════════════════════════
# RETRIEVER  (mirrors notebook Cell 8)
# ══════════════════════════════════════════════════════════════════════════════

def retrieve(
    query: str,
    n_results: int = 8,
    filters: Optional[dict] = None,
    auto_parse: bool = True,
) -> tuple[list[dict], dict]:
    """
    Retrieve the most semantically relevant chunks for a query.

    Returns (hits, parsed_info)
    hits: list of {text, metadata, score}
    """
    global _collection

    if _collection is None:
        raise RuntimeError("RAG index not initialized. Call initialize() first.")

    parsed_info: dict = {}

    if auto_parse:
        expanded, auto_filters, parsed_info = parse_query(query)
        if filters is None:
            filters = auto_filters
        query_vec = _get_embedder().encode([expanded]).tolist()
    else:
        query_vec = _get_embedder().encode([query]).tolist()

    def _do_query(where=None):
        kw: dict = dict(
            query_embeddings=query_vec,
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        if where:
            kw["where"] = where
        return _collection.query(**kw)

    # Try with filter first; fall back to no filter if empty result
    try:
        res = _do_query(filters)
        if not res["documents"][0]:
            raise ValueError("empty")
    except Exception:
        logger.warning("Filter returned no results or errored — falling back to unfiltered")
        res = _do_query()

    hits = [
        {"text": doc, "metadata": meta, "score": round(1 - dist, 4)}
        for doc, meta, dist in zip(
            res["documents"][0],
            res["metadatas"][0],
            res["distances"][0],
        )
    ]
    return hits, parsed_info


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP + PUBLIC HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def initialize(csv_path: str, chroma_path: str, force_rebuild: bool = False):
    """
    Main entry point — call once at server startup.
    Loads CSV, builds or loads ChromaDB index.
    """
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

"""
severity.py
-----------
Loads the .pkl RandomForestClassifier and builds the exact feature vector
it expects — one-hot category columns + keyword presence flags.

Feature list reverse-engineered from model.feature_names_in_:
  - category_* : one-hot of the incident category
  - everything else: 1 if that keyword appears in the text, 0 otherwise
"""

import logging
import re
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Singleton ──────────────────────────────────────────────────────────────────
_model = None

# Exact feature names the model was trained on (from model.feature_names_in_)
MODEL_FEATURES = [
    'category_Near Miss', 'category_Operational Efficiency', 'category_Quality',
    'category_Quality / Security', 'category_Reliability', 'category_Safety',
    'category_Safety / Near Miss', 'category_Security',
    'access', 'ai', 'ai system', 'breach', 'caf', 'caused', 'causes', 'chain',
    'chemical', 'cloud', 'confidential', 'confined', 'contractor', 'control',
    'crew', 'critical', 'cross', 'cyber', 'cyber triggered', 'dashboard', 'data',
    'digital', 'disrupts', 'document', 'drift', 'electrical', 'email', 'energy',
    'energy isolation', 'energy release', 'entry', 'equipment', 'error',
    'escalation', 'exposed', 'exposes', 'exposure', 'failure', 'falls', 'file',
    'header', 'home', 'home visitor', 'hr', 'hr file', 'hydraulic', 'incorrect',
    'interaction', 'interference', 'internal', 'isolation', 'isolation breach',
    'isolation drift', 'laptop', 'leads', 'led', 'line', 'minor', 'mis', 'model',
    'multi', 'multi energy', 'near', 'overhears', 'override', 'parallel',
    'pressure', 'pressure release', 'privilege', 'process', 'public', 'public caf',
    'release', 'release risk', 'remote', 'remote work', 'risk', 'risk', 'sensitive',
    'shared', 'solvent', 'system', 'tagging', 'team', 'toxic', 'transfer',
    'triggered', 'triggers', 'unauthorized', 'unauthorized entry',
    'unauthorized system', 'uncontrolled', 'unexpected', 'unsafe', 'valve',
    'vapour', 'visitor', 'visitor overhears', 'work', 'worker', 'workflow',
]

# All known categories (for one-hot encoding)
CATEGORIES = [
    'Near Miss', 'Operational Efficiency', 'Quality',
    'Quality / Security', 'Reliability', 'Safety',
    'Safety / Near Miss', 'Security',
]

SEVERITY_COLORS = {
    "High Severity":  "#ef4444",
    "Low Severity":   "#3b82f6",
    "Major":          "#ef4444",
    "Serious":        "#f97316",
    "Minor":          "#6b7280",
    "Unknown":        "#9ca3af",
}

# ── Keyword detection helpers ──────────────────────────────────────────────────

# Category keywords — used to infer category from raw text when not provided
CATEGORY_KEYWORDS = {
    'Security':               ['cyber', 'hack', 'breach', 'unauthorized', 'access', 'digital',
                                'laptop', 'email', 'data', 'privilege', 'phishing'],
    'Near Miss':              ['near miss', 'near-miss', 'close call', 'almost'],
    'Safety / Near Miss':     ['near miss', 'safety', 'hazard', 'injury', 'ppe'],
    'Quality / Security':     ['quality', 'security', 'compliance'],
    'Quality':                ['quality', 'compliance', 'audit', 'standard'],
    'Reliability':            ['equipment', 'failure', 'breakdown', 'maintenance', 'reliability'],
    'Operational Efficiency': ['efficiency', 'workflow', 'process', 'delay', 'productivity'],
    'Safety':                 ['chemical', 'vapor', 'vapour', 'spill', 'pressure', 'confined',
                                'electrical', 'fall', 'isolation', 'release', 'toxic'],
}


def _infer_category(text: str) -> str:
    """Guess the most likely category from text keywords."""
    lower = text.lower()
    scores = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        scores[cat] = sum(1 for kw in keywords if kw in lower)
    best = max(scores, key=lambda c: scores[c])
    return best if scores[best] > 0 else 'Safety'


def _build_feature_vector(text: str, category: Optional[str] = None) -> np.ndarray:
    """
    Build the exact feature vector the RandomForestClassifier expects.

    Parameters
    ----------
    text     : raw incident text (what_happened or full PDF text)
    category : incident category string. If None, inferred from text.
    """
    lower = text.lower()
    cat   = category or _infer_category(text)

    row = {}

    # ── One-hot category columns
    for c in CATEGORIES:
        row[f'category_{c}'] = 1 if cat == c else 0

    # ── Keyword presence features (1 if phrase found in text, else 0)
    for feat in MODEL_FEATURES:
        if feat.startswith('category_'):
            continue  # already handled above
        row[feat] = 1 if feat in lower else 0

    # Build numpy array in exact feature order
    vector = np.array([row.get(f, 0) for f in MODEL_FEATURES], dtype=float)
    return vector.reshape(1, -1)


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP
# ══════════════════════════════════════════════════════════════════════════════

def load_model(model_path: str) -> bool:
    global _model
    if not Path(model_path).exists():
        logger.warning(
            f"No severity model at '{model_path}'. "
            "Drop severity_model.pkl into backend/models/ to enable severity scoring."
        )
        return False
    try:
        import joblib, warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")   # suppress sklearn version mismatch warnings
            _model = joblib.load(model_path)
        logger.info(f"Severity model loaded from {model_path} ✅")
        logger.info(f"Model type: {type(_model).__name__}")
        logger.info(f"Classes: {list(_model.classes_)}")
        return True
    except Exception as e:
        logger.error(f"Failed to load severity model: {e}")
        return False


def is_loaded() -> bool:
    return _model is not None


# ══════════════════════════════════════════════════════════════════════════════
# INFERENCE
# ══════════════════════════════════════════════════════════════════════════════

def predict(text: str, category: Optional[str] = None) -> dict:
    """
    Predict severity from incident text.

    Builds the exact feature vector the RandomForestClassifier was trained on:
    one-hot category + keyword presence flags.

    Returns
    -------
    {
        label:      str    — e.g. "High Severity" or "Low Severity"
        confidence: float  — 0.0–1.0
        color:      str    — hex color for the UI badge
        scores:     dict   — {label: probability}
        available:  bool
    }
    """
    if _model is None:
        return {
            "label":      "Unknown",
            "confidence": 0.0,
            "color":      SEVERITY_COLORS["Unknown"],
            "scores":     {},
            "available":  False,
        }

    try:
        X = _build_feature_vector(text, category)

        if hasattr(_model, 'predict_proba'):
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                proba   = _model.predict_proba(X)[0]
            classes    = [str(c) for c in _model.classes_]
            best_idx   = int(np.argmax(proba))
            best_label = classes[best_idx]
            confidence = float(proba[best_idx])
            scores     = {classes[i]: round(float(p), 4) for i, p in enumerate(proba)}
        else:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                raw_label = _model.predict(X)[0]
            best_label = str(raw_label)
            confidence = 1.0
            scores     = {best_label: 1.0}

        return {
            "label":      best_label,
            "confidence": round(confidence, 4),
            "color":      SEVERITY_COLORS.get(best_label, "#9ca3af"),
            "scores":     scores,
            "available":  True,
        }

    except Exception as e:
        logger.error(f"Severity prediction error: {e}")
        return {
            "label":      "Unknown",
            "confidence": 0.0,
            "color":      SEVERITY_COLORS["Unknown"],
            "scores":     {},
            "available":  False,
            "error":      str(e),
        }

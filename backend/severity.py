"""
severity.py
-----------
Loads your teammate's .pkl severity model and runs inference.

ASSUMPTIONS — adjust _preprocess() and predict() if your model differs:
  Input:  raw text string (user's message)
  Output: severity class label + probability scores

If your model expects TF-IDF vectors or something other than raw text,
edit _preprocess() below. The rest of the code handles both
predict_proba() (gives confidence) and predict() (label only).
"""

import logging
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── Singleton ──────────────────────────────────────────────────────────────────
_model = None

# Color palette for severity badges in the frontend
SEVERITY_COLORS = {
    "Major":                   "#ef4444",
    "Serious":                 "#f97316",
    "Potentially Significant": "#eab308",
    "Near Miss":               "#3b82f6",
    "Minor":                   "#6b7280",
    "Unknown":                 "#9ca3af",
}


# ══════════════════════════════════════════════════════════════════════════════
# STARTUP
# ══════════════════════════════════════════════════════════════════════════════

def load_model(model_path: str) -> bool:
    """
    Load .pkl from disk. Called once at server startup.
    Returns True on success, False if file not found (severity disabled gracefully).
    """
    global _model

    if not Path(model_path).exists():
        logger.warning(
            f"No severity model found at '{model_path}'. "
            "Severity scoring will be disabled. "
            "To enable: drop severity_model.pkl into backend/models/"
        )
        return False

    try:
        import joblib
        _model = joblib.load(model_path)
        logger.info(f"Severity model loaded from {model_path} ✅")

        # Log what kind of model this is
        logger.info(f"Model type: {type(_model).__name__}")
        if hasattr(_model, "classes_"):
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

def _preprocess(text: str) -> str:
    """
    Clean text before passing to the model.
    Edit this if your teammate's model expects different preprocessing.
    """
    return " ".join(text.lower().split())


def predict(text: str) -> dict:
    """
    Predict severity from a text string.

    Returns
    -------
    {
        "label":      str    — e.g. "Major"
        "confidence": float  — 0.0–1.0
        "color":      str    — hex color for the badge
        "scores":     dict   — {label: probability} for all classes (if available)
        "available":  bool   — False when model not loaded (graceful degradation)
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
        processed = _preprocess(text)

        if hasattr(_model, "predict_proba"):
            # Pipeline with probability support — gives full confidence breakdown
            proba   = _model.predict_proba([processed])[0]
            classes = [str(c).title() for c in _model.classes_]

            best_idx   = int(np.argmax(proba))
            best_label = classes[best_idx]
            confidence = float(proba[best_idx])
            scores     = {classes[i]: round(float(p), 4) for i, p in enumerate(proba)}

        else:
            # Predict label only — no confidence score available
            raw_label  = _model.predict([processed])[0]
            best_label = str(raw_label).title()
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

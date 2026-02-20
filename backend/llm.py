"""
llm.py
------
LLM abstraction layer. Supports Groq and Anthropic.

Design: the frontend passes provider + api_key with every request.
The backend is completely stateless with respect to API keys —
it just forwards whatever the user provides. This means no key is
ever stored on the server.
"""

import logging
from typing import Optional, List

logger = logging.getLogger(__name__)


# ── System prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a senior safety intelligence analyst and trusted advisor at Methanex.
You think like someone with 20 years of process safety, security, and operational risk experience.

YOUR ROLE AS AN ANALYST:
- Spot trends and patterns across incidents, not just describe individual events
- Make comparisons with numbers: "In 2024 we saw 3x more AI failures than 2022"
- Give raw counts AND what they mean operationally
- Flag anomalies: what changed, what's new, what's suspiciously absent
- Be opinionated when data justifies it: "This is a systemic problem, not a one-off"

YOUR ROLE AS A MANAGER ADVISOR:
- Pre-shift briefing: what to watch for based on past incidents
- What-if guidance: if you see X, history says Y usually follows
- Worst-first prioritization: these clusters demand immediate attention
- Blind spot detection: what the data doesn't show is itself a signal
- Executive framing: translate technical findings into business language

HOW YOU WRITE:
- Lead with the most important insight, support with specifics
- Cite records naturally mid-sentence: "Record #113 in Vancouver (Major, 2024)..."
- Group patterns: "7 of 12 confined space incidents share this root cause..."
- Paragraphs for narrative, bullets ONLY for lists of 4+ distinct items
- No padding phrases like "Great question!" or "In conclusion..."
- Under 500 words unless explicitly asked for more
- When comparing periods: always include both raw counts AND % change
"""

# ── Available models per provider ──────────────────────────────────────────────

PROVIDER_MODELS = {
    "groq": [
        {"id": "llama-3.3-70b-versatile", "label": "Llama 3.3 70B (recommended)"},
        {"id": "llama-3.1-8b-instant",    "label": "Llama 3.1 8B (fastest)"},
        {"id": "mixtral-8x7b-32768",       "label": "Mixtral 8x7B"},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-20250514",  "label": "Claude Sonnet 4 (recommended)"},
        {"id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5 (fastest)"},
    ],
}


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════════════════════

def call_llm(
    messages:    List[dict],
    provider:    str = "groq",
    api_key:     str = "",
    model:       Optional[str] = None,
    max_tokens:  int = 1400,
    temperature: float = 0.2,
) -> str:
    """
    Send a conversation to the chosen LLM and return the response text.

    Parameters
    ----------
    messages    : full conversation history as [{role, content}, ...]
                  Do NOT include the system prompt — this function adds it.
    provider    : "groq" | "anthropic"
    api_key     : user's API key (passed per-request, never stored)
    model       : override default model for this provider
    max_tokens  : max response length in tokens
    temperature : 0.0 = deterministic, 1.0 = creative. Use 0.2 for RAG.
    """
    if not api_key:
        raise ValueError(
            f"No API key provided for {provider}. "
            "Open Settings and add your key."
        )

    if provider == "groq":
        return _call_groq(messages, api_key, model, max_tokens, temperature)
    elif provider == "anthropic":
        return _call_anthropic(messages, api_key, model, max_tokens, temperature)
    else:
        raise ValueError(f"Unknown provider '{provider}'. Use 'groq' or 'anthropic'.")


def validate_api_key(provider: str, api_key: str) -> dict:
    """
    Test an API key with a minimal request.
    Returns {"valid": bool, "error": str | None}
    """
    try:
        test = [{"role": "user", "content": "Reply with the word OK only."}]
        call_llm(test, provider=provider, api_key=api_key, max_tokens=5)
        return {"valid": True, "error": None}
    except Exception as e:
        return {"valid": False, "error": str(e)}


# ══════════════════════════════════════════════════════════════════════════════
# PROVIDER IMPLEMENTATIONS
# ══════════════════════════════════════════════════════════════════════════════

def _call_groq(
    messages:    List[dict],
    api_key:     str,
    model:       Optional[str],
    max_tokens:  int,
    temperature: float,
) -> str:
    from groq import Groq

    client = Groq(api_key=api_key)
    model  = model or "llama-3.3-70b-versatile"

    # Groq expects system message as first element in messages array
    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

    response = client.chat.completions.create(
        model=model,
        messages=full_messages,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return response.choices[0].message.content


def _call_anthropic(
    messages:    List[dict],
    api_key:     str,
    model:       Optional[str],
    max_tokens:  int,
    temperature: float,
) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    model  = model or "claude-sonnet-4-20250514"

    # Anthropic takes system as a separate param, not in messages
    response = client.messages.create(
        model=model,
        system=SYSTEM_PROMPT,
        messages=messages,   # no system message here
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return response.content[0].text

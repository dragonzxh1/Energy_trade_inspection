"""
Tavily Search API client.

Reads TAVILY_API_KEY (and optional TAVILY_API_KEY_BACKUP) from environment.
Falls back to mock results when no key is configured, so the pipeline can
run end-to-end without a live key during development.

Adapted from MyProjectSearchEngine — identical core logic, no project-specific code.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# HTTP status codes that indicate a quota/auth problem → try backup key
_FAILOVER_STATUS_CODES = {401, 402, 403, 429, 430, 432}
_FAILOVER_TEXT_HINTS = (
    "quota", "limit", "rate", "credit",
    "billing", "usage", "exhaust",
    "unauthorized", "forbidden",
)


def _get_api_keys() -> list[str]:
    keys: list[str] = []
    for env_name in ("TAVILY_API_KEY", "TAVILY_API_KEY_BACKUP"):
        value = (os.getenv(env_name) or "").strip()
        if value and value not in keys:
            keys.append(value)
    return keys


def _should_failover(exc: Exception) -> bool:
    response = getattr(exc, "response", None)
    status_code = getattr(response, "status_code", None)
    if status_code in _FAILOVER_STATUS_CODES:
        return True
    text = ""
    if response is not None:
        text = f"{getattr(response, 'text', '')} {getattr(response, 'reason_phrase', '')}".lower()
    if not text:
        text = str(exc).lower()
    return any(hint in text for hint in _FAILOVER_TEXT_HINTS)


def _normalize(data: dict) -> list[dict]:
    """Convert raw Tavily response to a stable, trimmed format."""
    out = []
    for r in data.get("results") or []:
        url = r.get("url") or ""
        domain = urlparse(url).netloc or ""
        out.append({
            "title":          (r.get("title") or "")[:2000],
            "url":            url[:4000],
            "domain":         domain[:255],
            "snippet":        (r.get("content") or "")[:5000],
            "provider_score": float(r["score"]) if r.get("score") is not None else None,
        })
    return out


def search(
    query: str,
    max_results: int = 10,
    *,
    include_domains: list[str] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    """
    Search via Tavily API. Returns list of dicts:
        title, url, domain, snippet, provider_score

    Parameters
    ----------
    query           : Search query string.
    max_results     : Maximum results to return (hard-capped at 20 by Tavily).
    include_domains : Restrict results to these domains (e.g. ["ofac.treas.gov"]).
    start_date      : Filter by date, format YYYY-MM-DD.
    end_date        : Filter by date, format YYYY-MM-DD.

    Returns [] and logs a warning if the API key is missing or the call fails.
    Returns mock results if no key is set (allows pipeline testing without a key).
    """
    api_keys = _get_api_keys()
    if not api_keys:
        logger.warning("TAVILY_API_KEY not set — returning mock results")
        return _mock(query, max_results)

    try:
        import httpx
    except ImportError:
        logger.error("httpx not installed; cannot call Tavily API")
        return []

    logger.info("Tavily search: %r  max=%s  domains=%s  dates=%s..%s",
                query[:80], min(max_results, 20),
                include_domains or "-", start_date or "-", end_date or "-")

    last_exc: Exception | None = None
    for idx, key in enumerate(api_keys):
        payload: dict = {
            "api_key":        key,
            "query":          query,
            "search_depth":   "advanced",
            "max_results":    min(max_results, 20),
            "include_answer": False,
            "include_raw_content": False,
        }
        if include_domains:
            payload["include_domains"] = list(include_domains)[:300]
        if start_date:
            payload["start_date"] = start_date
        if end_date:
            payload["end_date"] = end_date

        try:
            # trust_env=False：忽略系统代理设置，直连 Tavily API
            with httpx.Client(timeout=30.0, trust_env=False) as client:
                resp = client.post(TAVILY_SEARCH_URL, json=payload)
                resp.raise_for_status()
                return _normalize(resp.json())
        except Exception as exc:
            last_exc = exc
            if idx == 0 and len(api_keys) > 1 and _should_failover(exc):
                logger.warning("Tavily primary key quota/auth error — retrying with backup: %s", exc)
                continue
            logger.error("Tavily API error: %s", exc, exc_info=True)
            return []

    if last_exc:
        logger.error("Tavily exhausted all keys: %s", last_exc)
    return []


def _mock(query: str, max_results: int) -> list[dict]:
    """Stable mock for unit tests / no-key development."""
    return [{
        "title":          f"[Mock] {query}",
        "url":            "https://ofac.treas.gov/mock",
        "domain":         "ofac.treas.gov",
        "snippet":        "Mock result — set TAVILY_API_KEY to get real data.",
        "provider_score": 0.5,
    }][:max_results]

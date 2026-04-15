"""
Scrapling fetch helpers — unified interface for basic / stealth / dynamic modes.

Scrapling v0.4 notes:
  - Fetcher.get()        → basic HTTP, timeout in seconds
  - StealthyFetcher.fetch() → anti-bot / Cloudflare, timeout in milliseconds
  - DynamicFetcher.fetch()  → full JS execution, timeout in milliseconds
  - .body always returns bytes in v0.4 → decode manually
  - css_first() removed → use .css('...').get() or .css('...').first
  - get_all() removed  → use .getall()

Adapted from MyProjectSearchEngine with v0.4 compatibility fixes.
"""

from __future__ import annotations

import logging
from typing import Literal

logger = logging.getLogger(__name__)

FetchMode = Literal["basic", "stealth", "dynamic"]


def response_to_html(page) -> str:
    """
    Extract full HTML string from any Scrapling response object.

    v0.4: .body is always bytes; .html_content may not exist.
    Defensive fallback chain keeps this compatible with older versions too.
    """
    # v0.4+: body is bytes
    body = getattr(page, "body", None)
    if isinstance(body, bytes):
        return body.decode("utf-8", errors="replace")
    if body is not None:
        return str(body)
    # older versions may expose html_content as a string
    html = getattr(page, "html_content", None)
    if html is not None:
        return str(html)
    return str(page)


def fetch_html(
    url: str,
    *,
    timeout: int = 30,
    mode: FetchMode | str = "basic",
    wait_selector: str | None = None,
    google_search: bool | None = None,
) -> str:
    """
    Fetch a URL and return its HTML as a string.

    Parameters
    ----------
    url           : Target URL.
    timeout       : Seconds (basic) or seconds that get converted to ms (browser modes).
    mode          : "basic" | "stealth" | "dynamic"
                    basic   — plain HTTP, no JS, fastest
                    stealth — headless browser with anti-bot evasion + Cloudflare solver
                    dynamic — headless browser with full JS execution, no Cloudflare solver
    wait_selector : CSS selector to wait for before capturing HTML (browser modes only).
    google_search : Simulate arrival from Google. Defaults: True for stealth, False for dynamic.

    Raises on unrecoverable fetch errors (caller decides how to handle).
    """
    mode = (mode or "basic").strip().lower()

    if mode == "stealth":
        from scrapling.fetchers import StealthyFetcher
        gs = True if google_search is None else google_search
        logger.debug("Scrapling stealth fetch: %s  timeout=%ss  google_search=%s", url, timeout, gs)
        page = StealthyFetcher.fetch(
            url,
            timeout=max(timeout, 60) * 1000,   # Cloudflare solver needs ≥60 s
            headless=True,
            disable_resources=True,
            network_idle=True,
            solve_cloudflare=True,
            wait_selector=wait_selector,
            google_search=gs,
        )
        return response_to_html(page)

    if mode == "dynamic":
        from scrapling.fetchers import DynamicFetcher
        gs = False if google_search is None else google_search
        logger.debug("Scrapling dynamic fetch: %s  timeout=%ss", url, timeout)
        page = DynamicFetcher.fetch(
            url,
            timeout=timeout * 1000,
            headless=True,
            disable_resources=True,
            network_idle=True,
            wait_selector=wait_selector,
            google_search=gs,
        )
        return response_to_html(page)

    # default: basic HTTP
    from scrapling.fetchers import Fetcher
    logger.debug("Scrapling basic fetch: %s  timeout=%ss", url, timeout)
    page = Fetcher.get(url, timeout=timeout)
    return response_to_html(page)


def fetch_with_fallback(
    url: str,
    *,
    timeout: int = 30,
    modes: list[FetchMode] | None = None,
    min_html_length: int = 500,
    wait_selector: str | None = None,
) -> tuple[str, str]:
    """
    Try fetch modes in order until one returns sufficient HTML.

    Parameters
    ----------
    url             : Target URL.
    timeout         : Base timeout per attempt.
    modes           : Ordered list of modes to try. Default: ["basic", "stealth", "dynamic"].
    min_html_length : Minimum character count to consider a fetch successful.
    wait_selector   : CSS selector forwarded to browser modes.

    Returns
    -------
    (html, mode_used) — the HTML string and the mode that succeeded.
    Raises RuntimeError if all modes fail.
    """
    if modes is None:
        modes = ["basic", "stealth", "dynamic"]

    last_exc: Exception | None = None
    for mode in modes:
        try:
            html = fetch_html(url, timeout=timeout, mode=mode, wait_selector=wait_selector)
            if len(html) >= min_html_length:
                logger.info("fetch_with_fallback success: %s  mode=%s  len=%d", url, mode, len(html))
                return html, mode
            logger.warning("fetch_with_fallback: mode=%s returned only %d chars, trying next", mode, len(html))
        except Exception as exc:
            last_exc = exc
            logger.warning("fetch_with_fallback: mode=%s failed for %s: %s", mode, url, exc)

    raise RuntimeError(
        f"All fetch modes {modes} failed for {url}"
        + (f": {last_exc}" if last_exc else "")
    )

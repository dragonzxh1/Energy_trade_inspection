"""
Entity intelligence research for Energy Trade Inspection.

Uses Tavily to search for:
  - Sanctions news and designations
  - Corporate registration and contact info
  - Risk signals (fraud, investigations, money laundering)
  - Vessel port state control and tracking

Uses Scrapling to optionally enrich results by fetching page content.
"""

from __future__ import annotations

import logging

from intelligence.tavily_client import search as tavily_search
from intelligence.scrapling_fetch import fetch_html

logger = logging.getLogger(__name__)


# ─── Company / Organization research ─────────────────────────────────────────

def research_company(
    name: str,
    *,
    country: str | None = None,
    registration_number: str | None = None,
    max_results_per_query: int = 5,
    scrape_top_result: bool = False,
) -> dict:
    """
    Search for public intelligence about a company.

    Returns a dict with keys:
        name, country, registration_number,
        sanctions_hits, corporate_info, risk_signals, scraped_content
    """
    qualifier = f" {country}" if country else ""
    reg_hint   = f" {registration_number}" if registration_number else ""

    # 1. Sanctions / designations
    sanctions_hits = tavily_search(
        f'"{name}"{qualifier}{reg_hint} sanctions OR sanctioned OR OFAC OR "EU sanctions" OR blacklist',
        max_results=max_results_per_query,
    )

    # 2. Corporate registration and contact info
    corporate_info = tavily_search(
        f'"{name}"{qualifier} company registration OR headquarters OR director OR "registered address"',
        max_results=max_results_per_query,
    )

    # 3. Risk signals
    risk_signals = tavily_search(
        f'"{name}"{qualifier} fraud OR "money laundering" OR investigation OR "shell company" OR "beneficial owner"',
        max_results=max_results_per_query,
    )

    scraped: list[dict] = []
    if scrape_top_result and corporate_info:
        top_url = corporate_info[0].get("url", "")
        if top_url:
            try:
                html = fetch_html(top_url, timeout=20, mode="basic")
                scraped.append({"url": top_url, "html_length": len(html), "html_preview": html[:2000]})
            except Exception as exc:
                logger.warning("Scrape failed for %s: %s", top_url, exc)

    return {
        "name":                name,
        "country":             country,
        "registration_number": registration_number,
        "sanctions_hits":      sanctions_hits,
        "corporate_info":      corporate_info,
        "risk_signals":        risk_signals,
        "scraped_content":     scraped,
    }


# ─── Vessel research ──────────────────────────────────────────────────────────

def research_vessel(
    imo: str,
    *,
    vessel_name: str | None = None,
    flag: str | None = None,
    max_results_per_query: int = 5,
) -> dict:
    """
    Search for public intelligence about a vessel.

    Returns a dict with keys:
        imo, vessel_name, flag,
        sanctions_hits, port_state_control, tracking_info
    """
    name_hint = f' "{vessel_name}"' if vessel_name else ""
    flag_hint  = f" {flag}" if flag else ""

    # 1. Sanctions / designations
    sanctions_hits = tavily_search(
        f'IMO {imo}{name_hint} sanctions OR sanctioned OR OFAC OR "EU sanctions" OR "dark fleet"',
        max_results=max_results_per_query,
    )

    # 2. Port State Control (detentions, deficiencies)
    port_state = tavily_search(
        f'IMO {imo}{name_hint} port state control OR detention OR deficiency OR inspection',
        max_results=max_results_per_query,
    )

    # 3. Vessel tracking / AIS
    tracking = tavily_search(
        f'IMO {imo}{name_hint}{flag_hint} AIS tracking OR vessel position OR flag state',
        max_results=max_results_per_query,
    )

    return {
        "imo":                imo,
        "vessel_name":        vessel_name,
        "flag":               flag,
        "sanctions_hits":     sanctions_hits,
        "port_state_control": port_state,
        "tracking_info":      tracking,
    }


# ─── Storage terminal research ────────────────────────────────────────────────

def research_terminal(
    name: str,
    *,
    location: str | None = None,
    operator: str | None = None,
    max_results_per_query: int = 5,
) -> dict:
    """
    Search for public intelligence about a storage terminal / tank farm.

    核心验证问题：
    - 该终端在声称的地点是否真实存在？
    - 运营商是否合法、执照是否有效？
    - 是否有制裁关联（储存伊朗/俄罗斯原油等）？
    - 是否涉及"洗产地"或货物原产地造假？

    Returns a dict with keys:
        name, location, operator,
        sanctions_hits, existence_check, ownership_info, risk_signals
    """
    loc_hint = f' "{location}"' if location else ""
    op_hint  = f' "{operator}"' if operator else ""

    # 1. 制裁 / 合规问题
    sanctions_hits = tavily_search(
        f'"{name}"{loc_hint} sanctions OR OFAC OR "secondary sanctions" OR "Iran oil" OR "Russian oil" OR "sanctioned cargo"',
        max_results=max_results_per_query,
    )

    # 2. 真实性核查 — 该终端是否真实存在、容量如何
    existence_check = tavily_search(
        f'"{name}"{loc_hint} terminal OR "tank farm" OR storage capacity OR operator OR "oil terminal"',
        max_results=max_results_per_query,
    )

    # 3. 所有权 / 运营商调查
    ownership_info = tavily_search(
        f'"{name}"{loc_hint}{op_hint} owner OR operator OR "beneficial owner" OR parent company OR license OR permit',
        max_results=max_results_per_query,
    )

    # 4. 风险信号 — 事故、违规、"洗产地"报道
    risk_signals = tavily_search(
        f'"{name}"{loc_hint} fraud OR "origin laundering" OR investigation OR spill OR violation OR "shell company"',
        max_results=max_results_per_query,
    )

    return {
        "name":            name,
        "location":        location,
        "operator":        operator,
        "sanctions_hits":  sanctions_hits,
        "existence_check": existence_check,
        "ownership_info":  ownership_info,
        "risk_signals":    risk_signals,
    }


# ─── Quick authenticity signals ───────────────────────────────────────────────

def get_authenticity_signals(name: str, entity_type: str = "company") -> dict:
    """
    Lightweight check: does this entity have a credible web presence?

    Returns:
        web_presence_score  : 0–100 (higher = more credible online presence)
        signals             : list of positive/negative signal strings
        top_results         : raw Tavily results for the basic query
    """
    results = tavily_search(f'"{name}"', max_results=5)

    signals: list[str] = []
    score = 0

    if not results:
        signals.append("no_web_results")
        return {"web_presence_score": 0, "signals": signals, "top_results": []}

    # Check for official domain
    official_tlds = {".com", ".org", ".net", ".gov", ".edu"}
    for r in results:
        domain = r.get("domain", "")
        if any(domain.endswith(t) for t in official_tlds):
            score += 20
            signals.append(f"official_domain:{domain}")
            break

    # High Tavily score from top result
    top_score = results[0].get("provider_score") or 0
    if top_score > 0.7:
        score += 20
        signals.append("high_relevance_score")

    # Multiple independent sources
    unique_domains = {r.get("domain") for r in results}
    if len(unique_domains) >= 3:
        score += 20
        signals.append(f"multiple_sources:{len(unique_domains)}")

    # Sanction flags lower authenticity (or raise risk)
    sanction_keywords = {"ofac", "sanction", "blacklist", "designated"}
    for r in results:
        snippet = (r.get("snippet") or "").lower()
        if any(kw in snippet for kw in sanction_keywords):
            score -= 30
            signals.append("sanction_mention_in_results")
            break

    score = max(0, min(100, score))
    return {"web_presence_score": score, "signals": signals, "top_results": results}

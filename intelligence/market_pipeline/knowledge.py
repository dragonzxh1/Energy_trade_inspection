"""Versioned commodity knowledge-card loading and deterministic retrieval."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from .contracts import CommodityKnowledgeCard


DEFAULT_KNOWLEDGE_DIR = Path(__file__).parent.parent / "knowledge" / "commodity_frameworks"


def load_knowledge_cards(directory: Path = DEFAULT_KNOWLEDGE_DIR) -> dict[str, CommodityKnowledgeCard]:
    cards: dict[str, CommodityKnowledgeCard] = {}
    for path in sorted(directory.glob("*.yaml")):
        card = CommodityKnowledgeCard.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        if card.commodity_id in cards:
            raise ValueError(f"duplicate commodity knowledge card: {card.commodity_id}")
        cards[card.commodity_id] = card
    if not cards:
        raise ValueError(f"no commodity knowledge cards found in {directory}")
    return cards


def retrieve_knowledge_card(commodity: str, cards: dict[str, CommodityKnowledgeCard] | None = None) -> CommodityKnowledgeCard | None:
    cards = cards or load_knowledge_cards()
    normalized = commodity.casefold().strip()
    for card in cards.values():
        terms = {card.commodity_id.casefold(), *(alias.casefold() for alias in card.aliases)}
        if normalized in terms or any(term in normalized for term in terms if len(term) >= 3):
            return card
    return None


def sync_cards_to_obsidian(target_directory: Path, cards: dict[str, CommodityKnowledgeCard] | None = None) -> list[Path]:
    cards = cards or load_knowledge_cards()
    target_directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for card in cards.values():
        path = target_directory / f"{card.commodity_id}.md"
        frontmatter = yaml.safe_dump(
            {"schema_version": card.schema_version, "version": card.version, "updated_at": card.updated_at, "commodity_id": card.commodity_id},
            allow_unicode=True, sort_keys=False,
        )
        sections = [
            ("市场定义", [card.market_definition]), ("核心基准", card.core_benchmarks),
            ("核心价格与价差", card.core_prices_spreads), ("主要供给来源", card.supply_sources),
            ("主要需求端", card.demand_centers), ("区域贸易流", card.trade_flows),
            ("季节性因素", card.seasonality), ("关键替代关系", card.substitutions),
            ("常见驱动", card.drivers), ("典型传导路径", card.transmission_paths),
            ("可验证指标", card.validation_metrics), ("常见误判", card.common_misreads),
            ("失效条件", card.invalidation_conditions), ("数据缺口", card.data_gaps),
        ]
        body = [f"---\n{frontmatter}---\n", f"# {card.title}\n"]
        for title, items in sections:
            body.append(f"## {title}\n")
            body.extend(f"- {item}\n" for item in items)
        path.write_text("\n".join(body), encoding="utf-8")
        written.append(path)
    manifest = target_directory / "manifest.json"
    manifest.write_text(
        json.dumps({key: {"version": card.version, "updated_at": card.updated_at.isoformat()} for key, card in cards.items()}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    written.append(manifest)
    return written

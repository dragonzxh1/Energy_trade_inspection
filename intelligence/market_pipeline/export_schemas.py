"""Export versioned JSON Schemas for Dify and API contract tests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .contracts import (
    CommodityKnowledgeCard,
    FactExtractionResult,
    MarketFact,
    MarketMetric,
    MarketSignal,
    SourceDocument,
    TelegramInput,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export ETI market pipeline JSON Schemas")
    parser.add_argument(
        "--output",
        default=str(Path(__file__).parent.parent / "schemas" / "telegram_input.schema.json"),
    )
    parser.add_argument(
        "--metric-output",
        default=str(Path(__file__).parent.parent / "schemas" / "market_metric.schema.json"),
    )
    parser.add_argument(
        "--signal-output",
        default=str(Path(__file__).parent.parent / "schemas" / "market_signal.schema.json"),
    )
    parser.add_argument(
        "--knowledge-output",
        default=str(Path(__file__).parent.parent / "schemas" / "commodity_knowledge.schema.json"),
    )
    parser.add_argument(
        "--market-fact-output",
        default=str(Path(__file__).parent.parent / "schemas" / "market_fact.schema.json"),
    )
    parser.add_argument(
        "--fact-extraction-output",
        default=str(Path(__file__).parent.parent / "schemas" / "fact_extraction.schema.json"),
    )
    parser.add_argument(
        "--source-document-output",
        default=str(Path(__file__).parent.parent / "schemas" / "source_document.schema.json"),
    )
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(TelegramInput.model_json_schema(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(output)
    source_output = Path(args.source_document_output)
    source_output.parent.mkdir(parents=True, exist_ok=True)
    source_output.write_text(
        json.dumps(SourceDocument.model_json_schema(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(source_output)
    for target, contract in (
        (Path(args.market_fact_output), MarketFact),
        (Path(args.fact_extraction_output), FactExtractionResult),
        (Path(args.metric_output), MarketMetric),
        (Path(args.signal_output), MarketSignal),
        (Path(args.knowledge_output), CommodityKnowledgeCard),
    ):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(contract.model_json_schema(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(target)


if __name__ == "__main__":
    main()

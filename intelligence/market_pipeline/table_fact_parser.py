"""Deterministic source facts from native structured price tables."""

from __future__ import annotations

import hashlib
import re
import uuid
from datetime import date
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


PARSER_VERSION="structured-table-fact.v1"
FACT_NAMESPACE=uuid.UUID("86f92af0-35c6-4da4-b47e-f03520d5cc58")
CODE_VALUE=re.compile(r"^(?P<label>.+?)\s+(?P<code>[A-Z]{4,}\d{2})\s+(?P<value>-?\d+(?:\.\d+)?)$")
UNIT_PATTERN=re.compile(r"(\$/bbl|\$/mt|¢/gal|kgCO2e/bbl|kgCO2e/gal|kgCO2e/mt)",re.I)
UNIT_MAP={"$/bbl":"usd/bbl","$/mt":"usd/mt","¢/gal":"cents/gal"}


def _commodity(label: str) -> str | None:
    lowered=label.casefold()
    if "gasoline" in lowered or "cbob" in lowered: return "gasoline"
    if "jet" in lowered or "kero" in lowered: return "jet_fuel"
    if "ulsd" in lowered or "gasoil" in lowered or "diesel" in lowered: return "diesel"
    if "fuel oil" in lowered: return "fuel_oil"
    if "naphtha" in lowered: return "naphtha"
    return None


def parse_daily_table_cells(columns: list[str],rows: list[dict[str,Any]]) -> list[dict[str,Any]]:
    facts=[]
    for column in columns:
        if "daily" not in column.casefold() or "premium" not in column.casefold(): continue
        header_unit=UNIT_PATTERN.search(column)
        current_unit=header_unit.group(1) if header_unit else None
        current_unit_evidence=column
        current_region="Asia" if "asia" in column.casefold() else None
        for row in rows:
            cell=str(row.get(column) or "").strip()
            marker=UNIT_PATTERN.search(cell)
            if marker and not CODE_VALUE.match(cell):
                current_unit=marker.group(1)
                current_unit_evidence=cell
                if "united states gulf coast" in cell.casefold(): current_region="US Gulf Coast"
                elif "northwest europe" in cell.casefold(): current_region="Northwest Europe"
                continue
            match=CODE_VALUE.match(cell)
            if not match or not current_unit: continue
            label=match.group("label").strip(); commodity=_commodity(label)
            if not commodity: continue
            canonical_unit=UNIT_MAP.get(current_unit,current_unit)
            facts.append({"label":label,"commodity":commodity,"benchmark":match.group("code"),
                "value":float(match.group("value")),"unit":canonical_unit,"region":current_region,
                "evidence_text":cell,"table_header":column,"unit_evidence":current_unit_evidence})
    return facts


def sync_structured_table_facts(connection: Connection[Any],market_date_from: date,market_date_to: date) -> dict[str,int]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute("""
          SELECT table_data.*,document.market_date,document.source_id,document.id source_document_id,
                 section.id document_section_id,section.section_id document_section_key
          FROM parsed_tables table_data JOIN source_documents document ON document.id=table_data.source_document_id
          JOIN document_sections section ON section.id=table_data.document_section_id
          WHERE document.market_date BETWEEN %s AND %s AND document.source_verified
            AND table_data.parse_confidence>=0.8
        """,(market_date_from,market_date_to))
        tables=list(cursor.fetchall())
    created=updated=prices=0
    with connection.transaction(),connection.cursor(row_factory=dict_row) as cursor:
        for table in tables:
            for parsed in parse_daily_table_cells(table["columns_json"],table["rows_json"]):
                seed="\x1f".join((table["source_id"],table["table_id"],parsed["benchmark"],
                    table["market_date"].isoformat(),str(parsed["value"]),parsed["unit"]))
                fact_hash=hashlib.sha256(seed.encode()).hexdigest()
                fact_id=f"FACT-{uuid.uuid5(FACT_NAMESPACE,fact_hash)}"
                cursor.execute("""
                  INSERT INTO market_facts(fact_id,fact_hash,schema_version,source_document_id,document_section_id,
                    source_id,section_id,market_date,region,commodity,benchmark,fact_type,fact_class,statement,
                    value,unit,direction,evidence_text,confidence,verification_status,risk_level,metadata)
                  VALUES (%s,%s,'market-fact.v1',%s,%s,%s,%s,%s,%s,%s,%s,'premium_discount','source_fact',
                    %s,%s,%s,'unknown',%s,1,'pending','normal',%s)
                  ON CONFLICT(fact_hash) DO UPDATE SET statement=excluded.statement,value=excluded.value,
                    unit=excluded.unit,evidence_text=excluded.evidence_text,metadata=excluded.metadata,
                    source_document_id=excluded.source_document_id,
                    document_section_id=excluded.document_section_id,section_id=excluded.section_id,
                    is_current=true,superseded_at=null,updated_at=now() RETURNING id,(xmax=0) inserted
                """,(fact_id,fact_hash,table["source_document_id"],table["document_section_id"],table["source_id"],
                    table["document_section_key"],table["market_date"],parsed["region"],parsed["commodity"],parsed["benchmark"],
                    f"{parsed['label']} carbon intensity premium was {parsed['value']} {parsed['unit']}.",
                    parsed["value"],parsed["unit"],parsed["evidence_text"],Jsonb({"structured_table":True,
                    "table_id":table["table_id"],"table_cell":parsed["evidence_text"],
                    "table_header":parsed["table_header"],"unit_evidence":parsed["unit_evidence"],
                    "table_parse_method":table["parse_method"],"table_parse_confidence":table["parse_confidence"],
                    "parser_version":PARSER_VERSION})))
                result=cursor.fetchone(); created+=int(result["inserted"]); updated+=int(not result["inserted"])
                cursor.execute("""INSERT INTO market_prices(market_fact_id,market_date,commodity,region,benchmark,
                  price,unit,direction,source_id) VALUES(%s,%s,%s,%s,%s,%s,%s,'unknown',%s)
                  ON CONFLICT(market_fact_id) DO UPDATE SET price=excluded.price,unit=excluded.unit,updated_at=now()""",
                  (result["id"],table["market_date"],parsed["commodity"],parsed["region"],parsed["benchmark"],
                   parsed["value"],parsed["unit"],table["source_id"]))
                prices+=1
    return {"created":created,"updated":updated,"prices":prices,"tables":len(tables)}

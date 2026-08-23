"""Per-image page segmentation into logical regions and OCR cells."""

from __future__ import annotations

import csv
import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .roi import FieldROI, crop_roi, inset_bbox, refine_bbox_to_table_lines
from .template_align import TemplateAligner

logger = logging.getLogger(__name__)


@dataclass
class RegionSegment:
    """A logical page region, such as one product table or the spread matrix."""

    region_id: str
    region_type: str
    bbox: list[int]
    source: str


@dataclass
class CellSegment:
    """A single OCR cell generated from a region."""

    cell_id: str
    region_id: str
    region_type: str
    row_name: str
    field_name: str
    bbox: list[int]
    static_value: Any = None


def build_page_segments(
    img: np.ndarray,
    aligner: TemplateAligner,
    config: dict[str, Any],
) -> tuple[list[RegionSegment], list[CellSegment]]:
    """Build regions first, then cells inside each region."""
    regions = build_regions(img, aligner, config)
    cells = build_cells(regions, aligner, config)
    logger.info(f"Segmented page: {len(regions)} regions, {len(cells)} cells")
    return regions, cells


def rois_from_cells(img: np.ndarray, cells: list[CellSegment]) -> list[FieldROI]:
    """Create FieldROI crops from the generated cell table."""
    rois: list[FieldROI] = []
    for cell in cells:
        rois.append(FieldROI(
            table_id=cell.region_id,
            row_name=cell.row_name,
            field_name=cell.field_name,
            bbox=cell.bbox,
            image=crop_roi(img, cell.bbox),
            raw_text=str(cell.static_value) if cell.static_value is not None else "",
            clean_value=cell.static_value,
            confidence=100.0 if cell.static_value is not None else -1.0,
            status="static" if cell.static_value is not None else "ok",
            is_static=cell.static_value is not None,
        ))
    return rois


def build_regions(
    img: np.ndarray,
    aligner: TemplateAligner,
    config: dict[str, Any],
) -> list[RegionSegment]:
    """Build per-image logical region bboxes."""
    auto_refine = bool(config.get("image", {}).get("auto_refine_tables", False))
    regions: list[RegionSegment] = []

    if "date_region" in config:
        regions.append(RegionSegment(
            region_id="_summary",
            region_type="date",
            bbox=aligner.get_date_bbox(config["date_region"]),
            source="date_region",
        ))

    for table_cfg in config.get("tables", []):
        bbox = aligner.get_table_bbox(table_cfg)
        if table_cfg.get("auto_refine", auto_refine):
            bbox = refine_bbox_to_table_lines(img, bbox)
        regions.append(RegionSegment(
            region_id=table_cfg["id"],
            region_type="price_table",
            bbox=bbox,
            source="tables",
        ))

    if "spread_table" in config:
        spread_cfg = config["spread_table"]
        bbox = aligner.rel_to_abs(spread_cfg["bbox"])
        if spread_cfg.get("auto_refine", auto_refine):
            bbox = refine_bbox_to_table_lines(img, bbox)
        regions.append(RegionSegment(
            region_id="spread",
            region_type="spread_table",
            bbox=bbox,
            source="spread_table",
        ))

    if "conversion_table" in config:
        conv_cfg = config["conversion_table"]
        bbox = aligner.rel_to_abs(conv_cfg["bbox"])
        if conv_cfg.get("auto_refine", auto_refine):
            bbox = refine_bbox_to_table_lines(img, bbox)
        regions.append(RegionSegment(
            region_id="conversion",
            region_type="conversion_table",
            bbox=bbox,
            source="conversion_table",
        ))

    return regions


def build_cells(
    regions: list[RegionSegment],
    aligner: TemplateAligner,
    config: dict[str, Any],
) -> list[CellSegment]:
    """Build OCR cell bboxes from already segmented regions."""
    cells: list[CellSegment] = []
    region_by_id = {r.region_id: r for r in regions}

    if "_summary" in region_by_id:
        region = region_by_id["_summary"]
        cells.append(CellSegment(
            cell_id="date__summary_date",
            region_id="_summary",
            region_type="date",
            row_name="date",
            field_name="date",
            bbox=region.bbox,
        ))

    for table_cfg in config.get("tables", []):
        region = region_by_id.get(table_cfg["id"])
        if not region:
            continue
        cols = table_cfg["columns"]
        for row_cfg in table_cfg.get("rows", []):
            row_name = row_cfg["name"]
            row_y = row_cfg["y"]
            fields = row_cfg.get("fields", ["code", "mid", "change"])
            fixed_values = row_cfg.get("fixed_values", {})
            for field_name in fields:
                if field_name not in cols:
                    continue
                bbox = aligner.get_cell_bbox(region.bbox, cols[field_name], row_y)
                bbox = inset_bbox(bbox)
                cells.append(_cell(
                    region, row_name, field_name, bbox,
                    fixed_values.get(field_name),
                ))

            if row_cfg.get("has_extra") and "extra" in cols and "extra" in fields:
                extra_y = row_cfg.get("extra_y", [
                    row_y[0] + (row_y[1] - row_y[0]) * 0.5,
                    row_y[1],
                ])
                bbox = aligner.get_cell_bbox(region.bbox, cols["extra"], extra_y)
                bbox = inset_bbox(bbox)
                cells.append(_cell(
                    region, row_name, "extra", bbox,
                    fixed_values.get("extra"),
                ))

    spread_region = region_by_id.get("spread")
    spread_cfg = config.get("spread_table")
    if spread_region and spread_cfg:
        for row_cfg in spread_cfg.get("rows", []):
            row_name = f"{row_cfg['left_market']}|{row_cfg['right_market']}"
            for field_name, col_range in spread_cfg.get("columns", {}).items():
                bbox = aligner.get_cell_bbox(spread_region.bbox, col_range, row_cfg["y"])
                bbox = inset_bbox(bbox)
                cells.append(_cell(spread_region, row_name, field_name, bbox))

    conv_region = region_by_id.get("conversion")
    conv_cfg = config.get("conversion_table")
    if conv_region and conv_cfg:
        value_col = conv_cfg.get("columns", {}).get("mt_bbl", [0.05, 0.95])
        for row_cfg in conv_cfg.get("rows", []):
            bbox = aligner.get_cell_bbox(conv_region.bbox, value_col, row_cfg["y"])
            bbox = inset_bbox(bbox)
            cells.append(_cell(conv_region, row_cfg["name"], "mt_bbl", bbox))

    return cells


def save_segments(
    output_dir: str,
    image_stem: str,
    regions: list[RegionSegment],
    cells: list[CellSegment],
) -> None:
    """Save per-image segmentation artifacts for manual QA."""
    out = Path(output_dir) / "debug" / "segments"
    out.mkdir(parents=True, exist_ok=True)

    region_dicts = [asdict(r) for r in regions]
    cell_dicts = [asdict(c) for c in cells]

    (out / f"regions_{image_stem}.json").write_text(
        json.dumps(region_dicts, indent=2), encoding="utf-8"
    )
    (out / f"cells_{image_stem}.json").write_text(
        json.dumps(cell_dicts, indent=2), encoding="utf-8"
    )
    _write_csv(out / f"regions_{image_stem}.csv", region_dicts)
    _write_csv(out / f"cells_{image_stem}.csv", cell_dicts)


def save_segmentation_overlay(
    img: np.ndarray,
    output_dir: str,
    filename: str,
    regions: list[RegionSegment],
    cells: list[CellSegment],
) -> str:
    """Save an overlay showing regions and generated cells before OCR."""
    out = Path(output_dir) / "debug"
    out.mkdir(parents=True, exist_ok=True)
    overlay = img.copy()
    if overlay.ndim == 2:
        overlay = cv2.cvtColor(overlay, cv2.COLOR_GRAY2BGR)

    for region in regions:
        x1, y1, x2, y2 = region.bbox
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 128, 255), 2)
        cv2.putText(
            overlay, region.region_id, (x1, max(y1 - 8, 12)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 128, 255), 1, cv2.LINE_AA,
        )

    for cell in cells:
        x1, y1, x2, y2 = cell.bbox
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (180, 180, 180), 1)

    path = out / f"segmentation_{filename}"
    cv2.imwrite(str(path), overlay)
    logger.info(f"Segmentation overlay saved: {path}")
    return str(path)


def _cell(
    region: RegionSegment,
    row_name: str,
    field_name: str,
    bbox: list[int],
    static_value: Any = None,
) -> CellSegment:
    safe_row = row_name.replace(" ", "_").replace("/", "_").replace("|", "_")
    cell_id = f"{region.region_id}__{safe_row}__{field_name}"
    return CellSegment(
        cell_id=cell_id,
        region_id=region.region_id,
        region_type=region.region_type,
        row_name=row_name,
        field_name=field_name,
        bbox=bbox,
        static_value=static_value,
    )


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                fields.append(key)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

"""ROI cropping and field extraction."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

import cv2
import numpy as np

from .template_align import TemplateAligner

logger = logging.getLogger(__name__)


@dataclass
class FieldROI:
    """A single field extracted from the image."""
    table_id: str
    row_name: str
    field_name: str  # "code", "mid", "change", "extra", "date"
    bbox: list[int]  # absolute pixel coords [x1, y1, x2, y2]
    image: np.ndarray  # cropped image region
    raw_text: str = ""
    clean_value: Any = None
    confidence: float = -1.0
    status: str = "ok"  # ok, needs_review, failed
    candidates: list[dict[str, Any]] = field(default_factory=list)
    is_static: bool = False


def crop_roi(img: np.ndarray, bbox: list[int]) -> np.ndarray:
    """Crop a region from the image with bounds checking."""
    x1, y1, x2, y2 = [max(0, int(v)) for v in bbox]
    h, w = img.shape[:2]
    x2 = min(x2, w)
    y2 = min(y2, h)
    if x2 <= x1 or y2 <= y1:
        return np.zeros((10, 10, 3), dtype=np.uint8)
    return img[y1:y2, x1:x2]


def inset_bbox(bbox: list[int], x_frac: float = 0.08, y_frac: float = 0.24) -> list[int]:
    """Pad a cell bbox outward so OCR does not lose edge glyphs.

    The historical name is kept for compatibility with existing callers. In
    practice this now expands the OCR crop; clipping is handled by crop_roi().
    """
    x1, y1, x2, y2 = bbox
    w = max(0, x2 - x1)
    h = max(0, y2 - y1)
    dx = int(w * x_frac)
    dy = int(h * y_frac)
    return [x1 - dx, y1 - dy, x2 + dx, y2 + dy]


def refine_bbox_to_table_lines(
    img: np.ndarray,
    bbox: list[int],
    search_frac: float = 0.018,
    max_shift_frac: float = 0.035,
) -> list[int]:
    """Snap a configured table bbox to nearby detected table lines.

    The template still defines the table identity and rows/columns. This only
    compensates for small screenshot jitter by nudging the outer bbox to strong
    horizontal/vertical lines near the expected edges.
    """
    h, w = img.shape[:2]
    x1, y1, x2, y2 = bbox
    search_x = max(6, int(w * search_frac))
    search_y = max(6, int(h * search_frac))

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    dark = (gray < 120).astype(np.uint8) * 255

    def snap_x(expected: int, y_start: int, y_end: int) -> int:
        lo = max(0, expected - search_x)
        hi = min(w - 1, expected + search_x)
        segment = dark[max(0, y_start):min(h, y_end), lo:hi + 1]
        if segment.size == 0:
            return expected
        scores = segment.sum(axis=0)
        best = int(np.argmax(scores))
        if scores[best] < 255 * max(8, (y_end - y_start) * 0.08):
            return expected
        return lo + best

    def snap_y(expected: int, x_start: int, x_end: int) -> int:
        lo = max(0, expected - search_y)
        hi = min(h - 1, expected + search_y)
        segment = dark[lo:hi + 1, max(0, x_start):min(w, x_end)]
        if segment.size == 0:
            return expected
        scores = segment.sum(axis=1)
        best = int(np.argmax(scores))
        if scores[best] < 255 * max(8, (x_end - x_start) * 0.08):
            return expected
        return lo + best

    rx1 = snap_x(x1, y1, y2)
    rx2 = snap_x(x2, y1, y2)
    ry1 = snap_y(y1, x1, x2)
    ry2 = snap_y(y2, x1, x2)

    max_x_shift = max(4, int((x2 - x1) * max_shift_frac))
    max_y_shift = max(4, int((y2 - y1) * max_shift_frac))
    if abs(rx1 - x1) > max_x_shift:
        rx1 = x1
    if abs(rx2 - x2) > max_x_shift:
        rx2 = x2
    if abs(ry1 - y1) > max_y_shift:
        ry1 = y1
    if abs(ry2 - y2) > max_y_shift:
        ry2 = y2

    if rx2 <= rx1 or ry2 <= ry1:
        return bbox
    refined = [rx1, ry1, rx2, ry2]
    if refined != bbox:
        logger.debug(f"Refined table bbox {bbox} -> {refined}")
    return refined


def extract_all_rois(
    img: np.ndarray,
    aligner: TemplateAligner,
    config: dict[str, Any],
) -> list[FieldROI]:
    """Extract all ROI fields from the image based on template config.

    Returns a flat list of FieldROI objects for every cell.
    """
    rois: list[FieldROI] = []
    auto_refine = bool(config.get("image", {}).get("auto_refine_tables", True))

    # 1. Date field
    if "date_region" in config:
        date_cfg = config["date_region"]
        date_bbox = aligner.get_date_bbox(date_cfg)
        date_img = crop_roi(img, date_bbox)
        rois.append(FieldROI(
            table_id="_summary",
            row_name="date",
            field_name="date",
            bbox=date_bbox,
            image=date_img,
        ))

    # 2. Price tables
    for table_cfg in config.get("tables", []):
        table_id = table_cfg["id"]
        table_bbox = aligner.get_table_bbox(table_cfg)
        if auto_refine:
            table_bbox = refine_bbox_to_table_lines(img, table_bbox)
        cols = table_cfg["columns"]

        for row_cfg in table_cfg.get("rows", []):
            row_name = row_cfg["name"]
            row_y = row_cfg["y"]

            for field_name in ["code", "mid", "change"]:
                if field_name not in cols:
                    continue
                cell_bbox = aligner.get_cell_bbox(table_bbox, cols[field_name], row_y)
                cell_bbox = inset_bbox(cell_bbox)
                cell_img = crop_roi(img, cell_bbox)
                rois.append(FieldROI(
                    table_id=table_id,
                    row_name=row_name,
                    field_name=field_name,
                    bbox=cell_bbox,
                    image=cell_img,
                ))

            # Extra field (conv.MT or grey sub-price)
            if row_cfg.get("has_extra") and "extra" in cols:
                # Extra is in the mid column area but lower half
                mid_col = cols["extra"]
                extra_y = [
                    row_y[0] + (row_y[1] - row_y[0]) * 0.5,
                    row_y[1],
                ]
                cell_bbox = aligner.get_cell_bbox(table_bbox, mid_col, extra_y)
                cell_bbox = inset_bbox(cell_bbox)
                cell_img = crop_roi(img, cell_bbox)
                rois.append(FieldROI(
                    table_id=table_id,
                    row_name=row_name,
                    field_name="extra",
                    bbox=cell_bbox,
                    image=cell_img,
                ))

    # 3. Conversion table
    conv_cfg = config.get("conversion_table")
    if conv_cfg:
        conv_bbox = aligner.rel_to_abs(conv_cfg["bbox"])
        if auto_refine:
            conv_bbox = refine_bbox_to_table_lines(img, conv_bbox)
        value_col = conv_cfg.get("columns", {}).get("mt_bbl", [0.05, 0.95])
        for row_cfg in conv_cfg.get("rows", []):
            row_name = row_cfg["name"]
            row_y = row_cfg["y"]
            cell_bbox = aligner.get_cell_bbox(conv_bbox, value_col, row_y)
            cell_bbox = inset_bbox(cell_bbox)
            cell_img = crop_roi(img, cell_bbox)
            rois.append(FieldROI(
                table_id="conversion",
                row_name=row_name,
                field_name="mt_bbl",
                bbox=cell_bbox,
                image=cell_img,
            ))

    # 4. Spread table
    spread_cfg = config.get("spread_table")
    if spread_cfg:
        spread_bbox = aligner.rel_to_abs(spread_cfg["bbox"])
        if auto_refine:
            spread_bbox = refine_bbox_to_table_lines(img, spread_bbox)
        for row_cfg in spread_cfg.get("rows", []):
            left = row_cfg["left_market"]
            right = row_cfg["right_market"]
            row_y = row_cfg["y"]
            for col_name, col_range in spread_cfg.get("columns", {}).items():
                cell_bbox = aligner.get_cell_bbox(spread_bbox, col_range, row_y)
                cell_bbox = inset_bbox(cell_bbox)
                cell_img = crop_roi(img, cell_bbox)
                rois.append(FieldROI(
                    table_id="spread",
                    row_name=f"{left}|{right}",
                    field_name=col_name,
                    bbox=cell_bbox,
                    image=cell_img,
                ))

    logger.info(f"Extracted {len(rois)} ROIs")
    return rois

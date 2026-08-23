"""Template alignment and coordinate normalization."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


class TemplateAligner:
    """Maps relative coordinates (0..1) to absolute pixel coordinates."""

    def __init__(self, img_width: int, img_height: int, base_width: int, base_height: int):
        self.img_w = img_width
        self.img_h = img_height
        self.base_w = base_width
        self.base_h = base_height

    def rel_to_abs(self, rel_bbox: list[float]) -> list[int]:
        """Convert relative [x1, y1, x2, y2] to absolute pixel coords."""
        x1 = int(rel_bbox[0] * self.img_w)
        y1 = int(rel_bbox[1] * self.img_h)
        x2 = int(rel_bbox[2] * self.img_w)
        y2 = int(rel_bbox[3] * self.img_h)
        return [x1, y1, x2, y2]

    def rel_to_abs_xy(self, rel_x: float, rel_y: float) -> tuple[int, int]:
        return (int(rel_x * self.img_w), int(rel_y * self.img_h))

    def get_table_bbox(self, table_cfg: dict[str, Any]) -> list[int]:
        """Get absolute bbox for a table from config."""
        return self.rel_to_abs(table_cfg["bbox"])

    def get_cell_bbox(
        self,
        table_bbox: list[int],
        col_cfg: list[float],
        row_cfg: list[float],
    ) -> list[int]:
        """Compute absolute pixel bbox for a cell within a table.

        col_cfg/row_cfg are relative to the table bbox.
        """
        tx1, ty1, tx2, ty2 = table_bbox
        tw = tx2 - tx1
        th = ty2 - ty1

        cx1 = int(tx1 + col_cfg[0] * tw)
        cx2 = int(tx1 + col_cfg[1] * tw)
        ry1 = int(ty1 + row_cfg[0] * th)
        ry2 = int(ty1 + row_cfg[1] * th)

        return [cx1, ry1, cx2, ry2]

    def get_date_bbox(self, date_cfg: dict[str, Any]) -> list[int]:
        return self.rel_to_abs(date_cfg["bbox"])
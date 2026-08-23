"""Debug output utilities: save ROI images, overlay boxes, etc."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def save_aligned_image(img: np.ndarray, output_dir: str, filename: str) -> str:
    """Save the aligned/preprocessed image for debugging."""
    out = Path(output_dir) / "debug"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"aligned_{filename}"
    cv2.imwrite(str(path), img)
    return str(path)


def save_roi_images(
    rois: list[Any], output_dir: str, prefix: str = ""
) -> None:
    """Save each ROI crop as a separate image file.

    Naming: {prefix}_{table_id}_{row_name}_{field_name}.png
    """
    out = Path(output_dir) / "debug" / "rois"
    out.mkdir(parents=True, exist_ok=True)
    if prefix:
        for old in out.glob(f"*_{prefix}_*.png"):
            old.unlink()

    for i, roi in enumerate(rois):
        safe_name = (
            f"{prefix}_{roi.table_id}_{roi.row_name}_{roi.field_name}"
            .replace("/", "_")
            .replace(" ", "_")
            .replace("(", "")
            .replace(")", "")
            .replace("|", "_")
        )
        path = out / f"{i:04d}_{safe_name}.png"
        cv2.imwrite(str(path), roi.image)


def save_overlay_image(
    img: np.ndarray,
    rois: list[Any],
    output_dir: str,
    filename: str,
) -> str:
    """Draw ROI bounding boxes and OCR results on the image and save."""
    out = Path(output_dir) / "debug"
    out.mkdir(parents=True, exist_ok=True)

    overlay = img.copy()
    if overlay.ndim == 2:
        overlay = cv2.cvtColor(overlay, cv2.COLOR_GRAY2BGR)

    colors = {
        "code": (255, 0, 0),    # blue
        "mid": (0, 255, 0),      # green
        "change": (0, 0, 255),   # red
        "extra": (255, 255, 0),  # cyan
        "date": (255, 0, 255),   # magenta
        "mt_bbl": (128, 0, 128), # purple
    }

    for roi in rois:
        x1, y1, x2, y2 = roi.bbox
        color = colors.get(roi.field_name, (128, 128, 128))
        cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 1)

        label = f"{roi.table_id[:8]}|{roi.row_name[:10]}|{roi.field_name}"
        if roi.raw_text:
            label += f":{roi.raw_text[:12]}"
        cv2.putText(
            overlay, label, (x1, max(y1 - 3, 10)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.25, color, 1, cv2.LINE_AA,
        )

    path = out / f"overlay_{filename}"
    cv2.imwrite(str(path), overlay)
    logger.info(f"Overlay saved: {path}")
    return str(path)

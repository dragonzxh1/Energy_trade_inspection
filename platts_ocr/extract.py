"""Platts OCR - Main extraction script.

Extracts structured pricing data from Platts Summary screenshots
using template-based ROI cropping and multi-strategy Tesseract OCR.

Usage:
    python extract.py --input samples --output output/platts.xlsx --csv output/ --debug
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any

import yaml

from src.image_preprocess import load_and_preprocess, mask_relative_regions
from src.template_align import TemplateAligner
from src.ocr_engines import ocr_field
from src.segmentation import (
    build_page_segments,
    rois_from_cells,
    save_segmentation_overlay,
    save_segments,
)
from src.validators import (
    ReviewItem,
    ValidationResult,
    cross_date_validate,
    validate_field,
)
from src.exporters import export_csv, export_excel
from src.debug_utils import save_aligned_image, save_overlay_image, save_roi_images

# Configure Tesseract path (Windows)
import pytesseract
import platform
if platform.system() == "Windows":
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

logger = logging.getLogger("platts_ocr")


def setup_logging(debug: bool = False) -> None:
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("pytesseract").setLevel(logging.WARNING)


def load_config(template_path: str) -> dict[str, Any]:
    with open(template_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def process_image(
    img_path: str,
    config: dict[str, Any],
    output_dir: str,
    debug: bool = False,
    engine: str = "tesseract",
    fallback_engine: str | None = None,
    scale: int = 3,
    align_mode: str = "border-resize",
    max_rois: int | None = None,
    only_table: str | None = None,
    only_row: str | None = None,
    only_field: str | None = None,
    cell_id: str | None = None,
    segment_only: bool = False,
) -> dict[str, Any]:
    """Process a single image and return extracted data."""
    filename = Path(img_path).name
    logger.info(f"Processing: {filename}")

    base_w = config["image"]["base_width"]
    base_h = config["image"]["base_height"]

    # Preprocess
    target_size = (base_w * scale, base_h * scale)
    img = load_and_preprocess(
        img_path, scale=scale, deskew=True,
        align_to_template=True, template_size=target_size,
        align_mode=align_mode,
    )
    img = mask_relative_regions(img, config.get("ignore_regions", []))
    logger.info(f"Image shape after prep: {img.shape}")

    if debug:
        save_aligned_image(img, output_dir, filename)

    # Segment page into logical regions, then cells. OCR consumes this cell table.
    aligner = TemplateAligner(img.shape[1], img.shape[0], base_w, base_h)
    regions, cells = build_page_segments(img, aligner, config)
    if cell_id:
        cells = [cell for cell in cells if cell.cell_id == cell_id]
        logger.info(f"Filtered to cell '{cell_id}': {len(cells)} cells")
    if only_table:
        cells = [
            cell for cell in cells
            if cell.region_id == only_table or (only_table == "date" and cell.field_name == "date")
        ]
        logger.info(f"Filtered to table '{only_table}': {len(cells)} cells")
    if only_row:
        row_query = only_row.lower()
        cells = [cell for cell in cells if row_query in cell.row_name.lower()]
        logger.info(f"Filtered to row containing '{only_row}': {len(cells)} cells")
    if only_field:
        cells = [cell for cell in cells if cell.field_name == only_field]
        logger.info(f"Filtered to field '{only_field}': {len(cells)} cells")
    rois = rois_from_cells(img, cells)
    if max_rois is not None:
        rois = rois[:max_rois]
        logger.info(f"Limited to first {len(rois)} ROIs")

    if debug:
        save_segments(output_dir, Path(img_path).stem, regions, cells)
        save_segmentation_overlay(img, output_dir, filename, regions, cells)
        save_roi_images(rois, output_dir, Path(img_path).stem)
        save_overlay_image(img, rois, output_dir, filename)

    # OCR each ROI
    results: dict[str, Any] = {
        "filename": filename,
        "summary_date": None,
        "prices": [],
        "spreads": [],
        "conversions": [],
        "review_items": [],
    }

    if segment_only:
        logger.info("Segment-only mode: skipping OCR")
        _collect_results(rois, results)
        return results

    date_found = False
    for roi in rois:
        if not roi.is_static:
            ocr_result = ocr_field(roi.image, roi.field_name, engine, fallback_engine)

            roi.raw_text = ocr_result["raw_text"]
            roi.clean_value = ocr_result["clean_value"]
            roi.confidence = ocr_result["confidence"]
            roi.status = ocr_result["status"]
            roi.candidates = ocr_result.get("candidates", [])

        # Validate
        validation = validate_field(
            roi.field_name, roi.raw_text, roi.clean_value, roi.confidence,
        )
        if validation.status == "needs_review" and not roi.is_static:
            roi.status = "needs_review"

        # Handle date
        if roi.field_name == "date" and roi.clean_value:
            results["summary_date"] = roi.clean_value
            date_found = True

    # If no date found from OCR, try extracting from filename
    if not date_found:
        import re
        m = re.search(r"(\d{4}-\d{2}-\d{2})", filename)
        if m:
            results["summary_date"] = m.group(1)
            logger.warning(f"Date not found in image, using filename date: {results['summary_date']}")

    # Collect price rows
    _collect_results(rois, results)

    return results


def _collect_results(rois: list[Any], results: dict[str, Any]) -> None:
    """Organize ROIs into structured price/spread/conversion rows."""
    summary_date = results.get("summary_date", "")

    # Group by (table_id, row_name)
    price_groups: dict[tuple[str, str], dict[str, Any]] = {}
    spread_groups: dict[tuple[str, str], dict[str, Any]] = {}

    for roi in rois:
        if roi.field_name in ("date",):
            continue
        if roi.table_id == "conversion":
            _add_conversion(results, roi, summary_date)
            continue
        if roi.table_id == "spread":
            _add_spread(spread_groups, roi, summary_date)
            continue

        key = (roi.table_id, roi.row_name)
        if key not in price_groups:
            price_groups[key] = {
                "summary_date": summary_date,
                "table_id": roi.table_id,
                "row_name": roi.row_name,
                "validation_status": "ok",
                "validation_message": "",
            }
        group = price_groups[key]
        group[roi.field_name] = roi.clean_value
        group[f"raw_{roi.field_name}"] = roi.raw_text
        group[f"confidence_{roi.field_name}"] = roi.confidence
        group[f"status_{roi.field_name}"] = roi.status

    results["prices"] = list(price_groups.values())
    results["spreads"] = list(spread_groups.values())


def _add_conversion(
    results: dict[str, Any], roi: Any, summary_date: str,
) -> None:
    results["conversions"].append({
        "summary_date": summary_date,
        "product": roi.row_name,
        "mt_bbl": roi.clean_value,
        "raw_text": roi.raw_text,
        "confidence": roi.confidence,
        "status": roi.status,
    })


def _add_spread(
    spread_groups: dict[tuple[str, str], dict[str, Any]], roi: Any, summary_date: str,
) -> None:
    left, right = roi.row_name.split("|", 1)
    key = (left, right)
    if key not in spread_groups:
        spread_groups[key] = {
            "summary_date": summary_date,
            "left_market": left,
            "right_market": right,
        }
    group = spread_groups[key]
    group[roi.field_name] = roi.clean_value
    group[f"raw_{roi.field_name}"] = roi.raw_text
    group[f"confidence_{roi.field_name}"] = roi.confidence
    group[f"status_{roi.field_name}"] = roi.status


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Platts OCR - Extract pricing data from Platts Summary screenshots",
    )
    parser.add_argument(
        "--input", "-i", required=True,
        help="Input image file or directory of images",
    )
    parser.add_argument(
        "--output", "-o", default="output/platts.xlsx",
        help="Output Excel path (default: output/platts.xlsx)",
    )
    parser.add_argument(
        "--csv", default=None,
        help="Output CSV directory (default: None)",
    )
    parser.add_argument(
        "--engine", default="tesseract",
        choices=["tesseract", "rapidocr", "paddleocr"],
        help="OCR engine (default: tesseract)",
    )
    parser.add_argument(
        "--fallback-engine", default=None,
        choices=["none", "rapidocr", "paddleocr"],
        help="Fallback OCR engine (default: none)",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Enable debug output (saves aligned images, ROI crops, overlay)",
    )
    parser.add_argument(
        "--template", default="config/template.yaml",
        help="Template YAML path (default: config/template.yaml)",
    )
    parser.add_argument(
        "--scale", type=int, default=3,
        help="Image scale factor (default: 3)",
    )
    parser.add_argument(
        "--align-mode", default="border-resize",
        choices=["border-resize", "resize", "perspective", "none"],
        help=(
            "Template alignment mode (default: border-resize). "
            "Use resize to skip border cropping, perspective only if border detection is reliable."
        ),
    )
    parser.add_argument(
        "--max-rois", type=int, default=None,
        help="Debug speed option: OCR only the first N ROIs after template extraction.",
    )
    parser.add_argument(
        "--only-table", default=None,
        help="Debug speed option: OCR only one table id, e.g. ULSD_10ppm, spread, conversion, or date.",
    )
    parser.add_argument(
        "--only-row", default=None,
        help="OCR only cells whose row name contains this text, e.g. 'FOB Med'.",
    )
    parser.add_argument(
        "--only-field", default=None,
        help="OCR only one field name, e.g. code, mid, change, extra, mt_bbl, ULSD.",
    )
    parser.add_argument(
        "--cell-id", default=None,
        help="OCR exactly one generated cell id from debug/segments/cells_*.csv.",
    )
    parser.add_argument(
        "--segment-only", action="store_true",
        help="Generate per-image region/cell segmentation debug outputs and skip OCR.",
    )
    parser.add_argument(
        "--allow-full-ocr", action="store_true",
        help="Allow OCR over the entire generated cell table. Omit while calibrating.",
    )
    parser.add_argument(
        "--no-cross-date", action="store_true",
        help="Skip cross-date validation",
    )

    args = parser.parse_args()

    # Resolve paths relative to script location
    script_dir = Path(__file__).resolve().parent
    template_path = script_dir / args.template
    if not template_path.exists():
        template_path = Path(args.template)

    output_dir = str(Path(args.output).parent)

    setup_logging(args.debug)
    logger.info(f"Platts OCR starting | engine={args.engine}")

    scoped_ocr = any([
        args.max_rois is not None,
        args.only_table,
        args.only_row,
        args.only_field,
        args.cell_id,
    ])
    if not args.segment_only and not scoped_ocr and not args.allow_full_ocr:
        logger.error(
            "Full-page OCR is disabled during calibration. "
            "Use --segment-only, a scope flag such as --only-table/--only-row/--cell-id, "
            "or pass --allow-full-ocr explicitly."
        )
        sys.exit(2)

    config = load_config(str(template_path))

    # Collect input files
    input_path = Path(args.input)
    if input_path.is_dir():
        image_files = sorted(
            [str(p) for p in input_path.glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png")]
        )
    else:
        image_files = [str(input_path)]

    if not image_files:
        logger.error("No image files found")
        sys.exit(1)

    logger.info(f"Found {len(image_files)} image(s)")

    # Process each image
    all_prices: list[dict[str, Any]] = []
    all_spreads: list[dict[str, Any]] = []
    all_conversions: list[dict[str, Any]] = []
    all_reviews: list[ReviewItem] = []

    for img_path in image_files:
        try:
            result = process_image(
                img_path, config, output_dir,
                debug=args.debug, engine=args.engine,
                fallback_engine=args.fallback_engine if args.fallback_engine != "none" else None,
                scale=args.scale, align_mode=args.align_mode,
                max_rois=args.max_rois, only_table=args.only_table,
                only_row=args.only_row, only_field=args.only_field,
                cell_id=args.cell_id,
                segment_only=args.segment_only,
            )
            all_prices.extend(result["prices"])
            all_spreads.extend(result["spreads"])
            all_conversions.extend(result["conversions"])
            logger.info(
                f"  -> {result['summary_date']}: "
                f"{len(result['prices'])} prices, "
                f"{len(result['spreads'])} spreads, "
                f"{len(result['conversions'])} conversions"
            )
        except Exception as e:
            logger.error(f"Failed to process {img_path}: {e}", exc_info=args.debug)

    # Cross-date validation
    if not args.no_cross_date and len(all_prices) >= 2:
        logger.info("Running cross-date validation...")
        cross_reviews = cross_date_validate(all_prices)
        all_reviews.extend(cross_reviews)
        logger.info(f"  Cross-date issues: {len(cross_reviews)}")

    # Collect per-field validation issues
    for row in all_prices:
        for field in ("mid", "change", "code"):
            status = row.get(f"status_{field}", "ok")
            if status in ("needs_review", "failed"):
                all_reviews.append(ReviewItem(
                    date=row.get("summary_date", ""),
                    table_id=row.get("table_id", ""),
                    row_name=row.get("row_name", ""),
                    field_name=field,
                    code=row.get("code", ""),
                    raw_text=row.get(f"raw_{field}", ""),
                    clean_value=row.get(field),
                    issue=f"OCR {status}: {row.get(f'raw_{field}', '')}",
                ))

    for row in all_spreads:
        for field in ("ULSD", "JET-A1", "Gasoline", "Naphtha", "Gasoil_0.1", "FO_1.0"):
            status = row.get(f"status_{field}", "ok")
            if status in ("needs_review", "failed"):
                all_reviews.append(ReviewItem(
                    date=row.get("summary_date", ""),
                    table_id="spread",
                    row_name=f"{row.get('left_market', '')}|{row.get('right_market', '')}",
                    field_name=field,
                    code="",
                    raw_text=row.get(f"raw_{field}", ""),
                    clean_value=row.get(field),
                    issue=f"OCR {status}: {row.get(f'raw_{field}', '')}",
                ))

    for row in all_conversions:
        status = row.get("status", "ok")
        if status in ("needs_review", "failed"):
            all_reviews.append(ReviewItem(
                date=row.get("summary_date", ""),
                table_id="conversion",
                row_name=row.get("product", ""),
                field_name="mt_bbl",
                code="",
                raw_text=row.get("raw_text", ""),
                clean_value=row.get("mt_bbl"),
                issue=f"OCR {status}: {row.get('raw_text', '')}",
            ))

    # Export
    logger.info(f"Exporting: {len(all_prices)} prices, {len(all_spreads)} spreads, "
                f"{len(all_conversions)} conversions, {len(all_reviews)} review items")

    export_excel(args.output, all_prices, all_spreads, all_conversions, all_reviews)

    if args.csv:
        export_csv(args.csv, all_prices, all_spreads, all_conversions, all_reviews)

    logger.info("Done!")


if __name__ == "__main__":
    main()

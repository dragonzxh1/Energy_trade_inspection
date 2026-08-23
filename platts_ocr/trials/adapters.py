from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import time
import tracemalloc
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import yaml

from .contracts import PlattsSummaryRecord, PlattsSummaryTrialResult
from .normalization import (
    configure_tesseract,detect_duplicate_records,market_date_from_image_title,normalize_numeric,validate_iso_date,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE = ROOT / "config" / "template.yaml"
PRODUCT_UNITS = {
    "ULSD_10ppm": "USD/MT", "JET-A1": "USD/MT",
    "Gasoline_Prem_10ppm": "USD/MT", "Naphtha": "USD/MT",
    "Gasoil_0.1": "USD/MT", "FO_1.0": "USD/MT",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class TrialAdapter(ABC):
    parser_name: str

    def parse_platts_summary(self, image_path: str | Path, output_dir: str | Path) -> PlattsSummaryTrialResult:
        image = Path(image_path)
        destination = Path(output_dir) / self.parser_name / image.stem
        destination.mkdir(parents=True, exist_ok=True)
        tracemalloc.start()
        memory_stop = threading.Event()
        peak_rss_mb = [0.0]

        def sample_memory() -> None:
            try:
                import psutil

                process = psutil.Process()
                while not memory_stop.wait(0.05):
                    processes = [process, *process.children(recursive=True)]
                    rss = sum(item.memory_info().rss for item in processes if item.is_running())
                    peak_rss_mb[0] = max(peak_rss_mb[0], rss / 1024 / 1024)
            except Exception:
                return

        memory_thread = threading.Thread(target=sample_memory, daemon=True)
        memory_thread.start()
        started = time.perf_counter()
        try:
            result = self._parse(image, destination)
        except Exception as error:
            result = PlattsSummaryTrialResult(
                image_id=image.stem, image_sha256=_sha256(image), market_date=None,
                parser=self.parser_name, duration_ms=0,
                review_reasons=[f"PARSER_FAILED:{type(error).__name__}:{error}"],
            )
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        memory_stop.set()
        memory_thread.join(timeout=1)
        result.duration_ms = int((time.perf_counter() - started) * 1000)
        result.peak_memory_mb = round(max(peak / 1024 / 1024, peak_rss_mb[0]), 3)
        result.review_reasons.extend(detect_duplicate_records(result.records))
        result_path = destination / "result.json"
        if not result.raw_output_path:
            result.raw_output_path = str(result_path)
        result_path.write_text(json.dumps(result.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        return result

    @abstractmethod
    def _parse(self, image: Path, destination: Path) -> PlattsSummaryTrialResult:
        raise NotImplementedError


class TemplateTesseractAdapter(TrialAdapter):
    parser_name = "template_tesseract"

    def __init__(self, template_path: Path = DEFAULT_TEMPLATE) -> None:
        self.template_path = template_path

    def _parse(self, image: Path, destination: Path) -> PlattsSummaryTrialResult:
        configure_tesseract()
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from extract import load_config, process_image

        payload = process_image(
            str(image), load_config(str(self.template_path)), str(destination),
            debug=True, engine="tesseract", align_mode="border-resize",
        )
        records = template_payload_records(payload)
        reasons: list[str] = []
        market_date = market_date_from_image_title(str(image))
        payload_date = validate_iso_date(payload.get("summary_date"))
        if not market_date:
            reasons.append("DATE_NOT_READ_FROM_IMAGE_TITLE")
        elif payload_date and payload_date != market_date:
            reasons.append(f"DATE_CONFLICT:TEMPLATE={payload_date}:IMAGE_TITLE={market_date}")
        for row in [*payload.get("prices", []), *payload.get("spreads", []), *payload.get("conversions", [])]:
            for key, value in row.items():
                if key.startswith("status_") and value == "needs_review":
                    reasons.append(
                        f"FIELD_NEEDS_REVIEW:{row.get('table_id', row.get('product', 'unknown'))}:"
                        f"{row.get('row_name', row.get('left_market', ''))}:{key[7:]}"
                    )
            if row.get("status") == "needs_review":
                reasons.append(f"FIELD_NEEDS_REVIEW:{row.get('product', 'unknown')}")
        return PlattsSummaryTrialResult(
            image_id=image.stem, image_sha256=_sha256(image), market_date=market_date,
            parser=self.parser_name, duration_ms=0, records=records,
            review_reasons=sorted(set(reasons)),
        )


def template_payload_records(payload: dict[str, Any]) -> list[PlattsSummaryRecord]:
    records: list[PlattsSummaryRecord] = []
    for row in payload.get("prices", []):
        confidences = [float(row.get(f"confidence_{field}") or 0) for field in ("code", "mid", "change")]
        records.append(PlattsSummaryRecord(
            record_type="price", product=str(row.get("table_id", "")),
            location=str(row.get("row_name", "")), code=row.get("code"),
            mid_raw=row.get("raw_mid"), mid=row.get("mid"),
            change_raw=row.get("raw_change"), change=row.get("change"),
            currency="USD", unit=PRODUCT_UNITS.get(str(row.get("table_id"))),
            confidence=min(confidences) if confidences else 0,
        ))
    for row in payload.get("spreads", []):
        for product in ("ULSD", "JET-A1", "Gasoline", "Naphtha", "Gasoil_0.1", "FO_1.0"):
            if product not in row and f"raw_{product}" not in row:
                continue
            records.append(PlattsSummaryRecord(
                record_type="spread", product=product,
                from_market=row.get("left_market"), to_market=row.get("right_market"),
                mid_raw=row.get(f"raw_{product}"), mid=row.get(product),
                currency="USD", unit="USD/MT",
                confidence=float(row.get(f"confidence_{product}") or 0),
            ))
    for row in payload.get("conversions", []):
        records.append(PlattsSummaryRecord(
            record_type="conversion", product=str(row.get("product", "")),
            mid_raw=row.get("raw_text"), mid=row.get("mt_bbl"), unit="MT/bbl",
            confidence=float(row.get("confidence") or 0),
        ))
    return records


class DataFrameTableAdapter(TrialAdapter):
    def __init__(self, template_path: Path = DEFAULT_TEMPLATE) -> None:
        self.config = yaml.safe_load(template_path.read_text(encoding="utf-8"))

    def _masked_image(self, image: Path, destination: Path) -> Path:
        import cv2

        source = cv2.imread(str(image))
        if source is None:
            raise ValueError(f"cannot read image: {image}")
        height, width = source.shape[:2]
        for region in self.config.get("ignore_regions", []):
            left, top, right, bottom = region["bbox"]
            source[int(top * height):int(bottom * height), int(left * width):int(right * width)] = 255
        masked = destination / "masked_input.png"
        if not cv2.imwrite(str(masked), source):
            raise RuntimeError(f"cannot write masked image: {masked}")
        return masked

    def _records_from_frames(self, frames: list[dict[str, Any]]) -> tuple[list[PlattsSummaryRecord], list[str]]:
        records: list[PlattsSummaryRecord] = []
        reasons: list[str] = []
        price_tables = [table["id"] for table in self.config["tables"]]
        for index, item in enumerate(frames):
            frame = item["frame"]
            label = item.get("label") or (price_tables[index] if index < len(price_tables) else "")
            columns = [str(value).strip().casefold() for value in frame.columns]
            if label == "conversion" or any("conversion" in value for value in columns):
                for _, row in frame.iterrows():
                    values = [str(value).strip() for value in row.tolist() if str(value).strip()]
                    if len(values) >= 2:
                        records.append(PlattsSummaryRecord(
                            record_type="conversion", product=values[0], mid_raw=values[-1],
                            mid=normalize_numeric(values[-1]), unit="MT/bbl", cell_bbox=item.get("bbox"),
                        ))
                continue
            if label == "spread":
                reasons.append(f"GENERIC_SPREAD_REQUIRES_REVIEW:table_{index}")
                continue
            if label not in price_tables:
                reasons.append(f"UNMAPPED_TABLE:table_{index}")
                continue
            for row_index, row in frame.iterrows():
                values = [str(value).strip() for value in row.tolist()]
                if len(values) < 4 or not values[0] or values[0].casefold() == "name":
                    continue
                records.append(PlattsSummaryRecord(
                    record_type="price", product=label, location=values[0], code=values[1] or None,
                    mid_raw=values[2], mid=normalize_numeric(values[2]),
                    change_raw=values[3], change=normalize_numeric(values[3], change=True),
                    currency="USD", unit=PRODUCT_UNITS.get(label),
                    cell_bbox=_row_bbox(item.get("cell_bboxes"),row_index) or item.get("bbox"),
                ))
        return records, reasons


class Img2TablePaddleAdapter(DataFrameTableAdapter):
    parser_name = "img2table_paddle"

    def _parse(self, image: Path, destination: Path) -> PlattsSummaryTrialResult:
        try:
            from img2table.document import Image
            from img2table.ocr import PaddleOCR
        except ImportError as error:
            raise RuntimeError("img2table[paddle] is not installed") from error
        masked_image = self._masked_image(image, destination)
        os.environ.setdefault("FLAGS_use_mkldnn", "0")
        document = Image(str(masked_image), detect_rotation=False)
        tables = document.extract_tables(
            ocr=PaddleOCR(lang="en", kw={"enable_mkldnn": False}), implicit_rows=True,
            borderless_tables=False, min_confidence=50,
        )
        frames = []
        raw_tables = []
        for table in tables:
            bbox = [table.bbox.x1, table.bbox.y1, table.bbox.x2, table.bbox.y2]
            cell_bboxes = [
                [[cell.bbox.x1,cell.bbox.y1,cell.bbox.x2,cell.bbox.y2] for cell in row]
                for row in table.content.values()
            ]
            frames.append({"frame": table.df, "bbox": bbox, "cell_bboxes": cell_bboxes})
            raw_tables.append({
                "title":table.title,"bbox":bbox,"rows":table.df.fillna("").values.tolist(),
                "cell_bboxes":cell_bboxes,
            })
        raw_path=destination/"img2table_raw.json"
        raw_path.write_text(json.dumps(raw_tables,ensure_ascii=False,indent=2),encoding="utf-8")
        (destination/"img2table_tables.html").write_text(
            "<html><body>"+"\n".join(table.html for table in tables)+"</body></html>",encoding="utf-8",
        )
        if frames:
            import pandas as pd

            with pd.ExcelWriter(destination/"img2table_tables.xlsx") as writer:
                for index,item in enumerate(frames):
                    item["frame"].to_excel(writer,sheet_name=f"table_{index+1}",index=False)
        records, reasons = self._records_from_frames(frames)
        if tables:
            reasons.append("OCR_CONFIDENCE_UNAVAILABLE_FROM_IMG2TABLE")
        else:
            reasons.append("NO_TABLES_DETECTED")
        market_date=market_date_from_image_title(str(image))
        if not market_date:
            reasons.append("DATE_NOT_READ_FROM_IMAGE_TITLE")
        return PlattsSummaryTrialResult(
            image_id=image.stem, image_sha256=_sha256(image), market_date=market_date,
            parser=self.parser_name, duration_ms=0, records=records,
            review_reasons=reasons, raw_output_path=str(raw_path),
        )


class PPStructureV3Adapter(DataFrameTableAdapter):
    parser_name = "ppstructure_v3"

    def _parse(self, image: Path, destination: Path) -> PlattsSummaryTrialResult:
        try:
            import pandas as pd
            from paddleocr import PPStructureV3
        except ImportError as error:
            raise RuntimeError("PaddleOCR PP-StructureV3 is not installed") from error
        os.environ.setdefault("FLAGS_use_mkldnn", "0")
        masked_image = self._masked_image(image, destination)
        pipeline = PPStructureV3(
            lang="en", use_doc_orientation_classify=False, use_doc_unwarping=False,
            enable_mkldnn=False,
        )
        outputs = list(pipeline.predict(str(masked_image)))
        serializable: list[Any] = []
        frames: list[dict[str, Any]] = []
        all_html: list[str] = []
        market_date = None
        for output in outputs:
            value = output.json if hasattr(output, "json") else output
            value = value() if callable(value) else value
            serializable.append(value)
            text = json.dumps(value, ensure_ascii=False, default=str)
            from .normalization import market_date_from_title_text
            market_date = market_date or market_date_from_title_text(text)
            html_values = []
            if isinstance(value, dict):
                html_values.extend(_find_html(value))
            all_html.extend(html_values)
            for html in html_values:
                try:
                    from io import StringIO

                    for frame in pd.read_html(StringIO(html)):
                        frames.append({"frame": frame})
                except ValueError:
                    continue
        raw_path=destination/"ppstructure_raw.json"
        raw_path.write_text(
            json.dumps(serializable, ensure_ascii=False, indent=2, default=str), encoding="utf-8",
        )
        (destination/"ppstructure_tables.html").write_text(
            "<html><body>"+"\n".join(all_html)+"</body></html>",encoding="utf-8",
        )
        if frames:
            with pd.ExcelWriter(destination/"ppstructure_tables.xlsx") as writer:
                for index,item in enumerate(frames):
                    item["frame"].to_excel(writer,sheet_name=f"table_{index+1}",index=False)
        records, reasons = self._records_from_frames(frames)
        if not frames:
            reasons.append("NO_TABLES_DETECTED")
        market_date=market_date or market_date_from_image_title(str(image))
        if not market_date:
            reasons.append("DATE_NOT_READ_FROM_IMAGE_TITLE")
        return PlattsSummaryTrialResult(
            image_id=image.stem, image_sha256=_sha256(image), market_date=market_date,
            parser=self.parser_name, duration_ms=0, records=records, review_reasons=reasons,
            raw_output_path=str(raw_path),
        )


def _find_html(value: Any) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key.casefold() in {"html", "pred_html"} and isinstance(item, str) and "<table" in item:
                found.append(item)
            else:
                found.extend(_find_html(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(_find_html(item))
    return found


def _row_bbox(cell_bboxes: list[list[list[int]]] | None, row_index: Any) -> list[int] | None:
    if not cell_bboxes or not isinstance(row_index,int) or row_index >= len(cell_bboxes):
        return None
    row=cell_bboxes[row_index]
    if not row:
        return None
    return [min(cell[0] for cell in row),min(cell[1] for cell in row),
            max(cell[2] for cell in row),max(cell[3] for cell in row)]


ADAPTERS = {
    "template_tesseract": TemplateTesseractAdapter,
    "img2table_paddle": Img2TablePaddleAdapter,
    "ppstructure_v3": PPStructureV3Adapter,
}


def parse_platts_summary(
    image_path: str | Path, *, parser: str = "template_tesseract", output_dir: str | Path,
) -> PlattsSummaryTrialResult:
    try:
        adapter = ADAPTERS[parser]()
    except KeyError as error:
        raise ValueError(f"unsupported parser: {parser}") from error
    return adapter.parse_platts_summary(image_path, output_dir)

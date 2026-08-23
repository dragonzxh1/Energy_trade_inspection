from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any


FIELDS = ("product", "location", "code", "mid", "change", "unit", "from_market", "to_market")
THRESHOLDS = {
    "date_accuracy": 1.0,
    "product_location_code_accuracy": 0.99,
    "critical_numeric_accuracy": 0.995,
    "sign_accuracy": 1.0,
    "unit_accuracy": 1.0,
    "row_column_accuracy": 0.995,
    "repeatability": 1.0,
    "review_capture_rate": 1.0,
    "duplicate_free_rate": 1.0,
}


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_result(value: dict[str, Any]) -> dict[str, Any]:
    ignored = {"duration_ms", "peak_memory_mb", "raw_output_path"}
    return {key: item for key, item in value.items() if key not in ignored}


def _record_map(records: list[dict[str, Any]]) -> dict[tuple[str, str, str, str, str], dict[str, Any]]:
    return {
        (
            record["record_type"], record["product"], record.get("location") or "",
            record.get("from_market") or "", record.get("to_market") or "",
        ): record
        for record in records
    }


def _record_identity(record: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (
        record["record_type"], record["product"], record.get("location") or "",
        record.get("from_market") or "", record.get("to_market") or "",
    )


def _non_empty(value: Any) -> bool:
    return value is not None and (not isinstance(value, str) or bool(value.strip()))


def _record_is_well_formed(record: Any) -> bool:
    return (
        isinstance(record, dict)
        and _non_empty(record.get("record_type"))
        and _non_empty(record.get("product"))
    )


def _ground_truth_invalid_reasons(truth: dict[str, Any]) -> list[str]:
    reasons=[]
    if truth.get("verification_status") != "human_verified":
        reasons.append("verification_status")
    for field in ("reviewer", "verified_at", "market_date"):
        if not _non_empty(truth.get(field)):
            reasons.append(field)
    records=truth.get("records")
    if not isinstance(records, list) or not records:
        reasons.append("records")
    elif any(
        not isinstance(record, dict)
        or not _non_empty(record.get("record_type"))
        or not _non_empty(record.get("product"))
        for record in records
    ):
        reasons.append("record_identity")
    return reasons


def _template_cell_bbox(
    run_dir: Path, image_id: str, identity: tuple[str, str, str, str, str], field: str,
) -> list[int] | None:
    cells_path = (
        run_dir / "raw" / "template_tesseract" / image_id / "debug" / "segments" / f"cells_{image_id}.json"
    )
    if not cells_path.exists():
        return None
    record_type, product, location, from_market, to_market = identity
    if record_type == "price":
        expected = (product, location, field)
    elif record_type == "spread":
        expected = ("spread", f"{from_market}|{to_market}", product)
    else:
        expected = ("conversion", product, "mt_bbl")
    for cell in _load(cells_path):
        if (cell.get("region_id"), cell.get("row_name"), cell.get("field_name")) == expected:
            return [round(value / 3) for value in cell["bbox"]]
    return None


def evaluate_parser(
    ground_truth_dir: Path, run_one_dir: Path, run_two_dir: Path, parser: str,
) -> dict[str, Any]:
    totals: defaultdict[str, int] = defaultdict(int)
    errors: list[dict[str, Any]] = []
    durations: list[int] = []
    memories: list[float] = []
    ground_truth_files = sorted(ground_truth_dir.glob("*.json"))
    expected_samples = len(ground_truth_files)
    evaluated_samples = 0
    missing_output_files: list[str] = []
    invalid_ground_truth_files: list[str] = []
    extra_record_count = 0
    hallucinated_non_null_fields = 0
    invalid_market_date_source_count = 0
    confirmed = 0
    for truth_path in ground_truth_files:
        first_path = run_one_dir / parser / f"{truth_path.stem}.json"
        second_path = run_two_dir / parser / f"{truth_path.stem}.json"
        missing_paths = [path for path in (first_path, second_path) if not path.exists()]
        truth = _load(truth_path)
        invalid_reasons = _ground_truth_invalid_reasons(truth)
        if invalid_reasons:
            invalid_ground_truth_files.append(str(truth_path))
            errors.append({
                "image_id": truth_path.stem, "code": "GROUND_TRUTH_INVALID",
                "reasons": invalid_reasons,
            })
        if missing_paths:
            missing_output_files.extend(str(path) for path in missing_paths)
            errors.append({
                "image_id": truth_path.stem, "code": "PARSER_OUTPUT_MISSING",
                "paths": [str(path) for path in missing_paths],
            })
        if invalid_reasons or missing_paths:
            continue
        confirmed += 1
        first = _load(first_path)
        second = _load(second_path)
        evaluated_samples += 1
        durations.append(first.get("duration_ms", 0))
        memories.append(first.get("peak_memory_mb") or 0)
        for run_name, output in (("run_1", first), ("run_2", second)):
            if output.get("market_date_source") != "image_title":
                invalid_market_date_source_count += 1
                errors.append({
                    "image_id": truth_path.stem, "run": run_name,
                    "code": "MARKET_DATE_SOURCE_INVALID",
                    "actual": output.get("market_date_source"),
                })
        totals["date_total"] += 1
        totals["date_correct"] += int(first.get("market_date") == truth.get("market_date"))
        totals["repeat_total"] += 1
        totals["repeat_correct"] += int(_canonical_result(first) == _canonical_result(second))
        truth_records = _record_map(truth.get("records", []))
        actual_records_list = first.get("records", [])
        if not isinstance(actual_records_list, list):
            actual_records_list=[]
            errors.append({"image_id": truth_path.stem, "code": "PARSER_RECORDS_INVALID"})
        valid_actual_records=[]
        malformed_record_count=0
        for record_index, record in enumerate(actual_records_list):
            if not _record_is_well_formed(record):
                malformed_record_count += 1
                extra_record_count += 1
                errors.append({
                    "image_id": truth_path.stem, "record_index": record_index,
                    "code": "MALFORMED_EXTRA_RECORD", "record": record,
                })
                continue
            valid_actual_records.append(record)
        actual_records = _record_map(valid_actual_records)
        identities = [_record_identity(record) for record in valid_actual_records]
        for identity in identities:
            if identity not in truth_records:
                extra_record_count += 1
                errors.append({
                    "image_id": truth_path.stem, "identity": identity,
                    "code": "EXTRA_RECORD",
                })
        totals["duplicate_free_total"] += 1
        totals["duplicate_free_correct"] += int(
            malformed_record_count == 0 and len(identities) == len(set(identities))
        )
        totals["record_total"] += len(truth_records)
        totals["record_found"] += len(set(truth_records) & set(actual_records))
        image_errors: list[dict[str, Any]] = []
        for identity, expected in truth_records.items():
            totals["row_total"] += 1
            actual = actual_records.get(identity)
            if actual is None:
                image_errors.append({"image_id": truth_path.stem, "identity": identity, "code": "RECORD_MISSING"})
                continue
            totals["row_correct"] += 1
            for field in FIELDS:
                if expected.get(field) is None and actual.get(field) is not None:
                    hallucinated_non_null_fields += 1
                    image_errors.append({
                        "image_id": truth_path.stem, "identity": identity, "field": field,
                        "expected": None, "actual": actual.get(field),
                        "code": "HALLUCINATED_NON_NULL_FIELD",
                    })
                    continue
                if expected.get(field) is None:
                    continue
                totals[f"{field}_total"] += 1
                correct = actual.get(field) == expected.get(field)
                totals[f"{field}_correct"] += int(correct)
                if not correct:
                    cell_bbox = actual.get("cell_bbox")
                    if not cell_bbox and parser == "template_tesseract":
                        cell_bbox = _template_cell_bbox(run_one_dir, truth_path.stem, identity, field)
                    image_errors.append({
                        "image_id": truth_path.stem, "identity": identity, "field": field,
                        "expected": expected.get(field), "actual": actual.get(field),
                        "cell_bbox": cell_bbox,
                    })
            for field in ("mid", "change"):
                if expected.get(field) is None:
                    continue
                totals["numeric_total"] += 1
                totals["numeric_correct"] += int(actual.get(field) == expected.get(field))
                totals["sign_total"] += 1
                sign = lambda value: 0 if value == 0 else (1 if value and value > 0 else -1)
                totals["sign_correct"] += int(
                    actual.get(field) is not None and sign(actual.get(field)) == sign(expected.get(field))
                )
        errors.extend(image_errors)
        review_reasons = first.get("review_reasons",[]) or []
        for error in image_errors:
            if error.get("field") not in {"mid","change","unit"}:
                continue
            totals["review_total"] += 1
            identity = error["identity"]
            exact_prefix = f"FIELD_NEEDS_REVIEW:{identity[1]}:{identity[2]}:{error['field']}"
            captured = any(
                reason.startswith(exact_prefix)
                or reason.startswith("PARSER_FAILED:")
                or reason == "OCR_CONFIDENCE_UNAVAILABLE_FROM_IMG2TABLE"
                for reason in review_reasons
            )
            totals["review_captured"] += int(captured)

    def ratio(correct: str, total: str) -> float:
        return round(totals[correct] / totals[total], 6) if totals[total] else 0.0

    identity_correct = sum(totals[f"{field}_correct"] for field in ("product", "location", "code"))
    identity_total = sum(totals[f"{field}_total"] for field in ("product", "location", "code"))
    metrics = {
        "date_accuracy": ratio("date_correct", "date_total"),
        "product_location_code_accuracy": round(identity_correct / identity_total, 6) if identity_total else 0.0,
        "critical_numeric_accuracy": ratio("numeric_correct", "numeric_total"),
        "sign_accuracy": ratio("sign_correct", "sign_total"),
        "unit_accuracy": ratio("unit_correct", "unit_total"),
        "row_column_accuracy": ratio("row_correct", "row_total"),
        "record_recall": ratio("record_found", "record_total"),
        "repeatability": ratio("repeat_correct", "repeat_total"),
        "review_capture_rate": ratio("review_captured", "review_total") if totals["review_total"] else 1.0,
        "duplicate_free_rate": ratio("duplicate_free_correct","duplicate_free_total"),
    }
    passed = (
        expected_samples == 10
        and evaluated_samples == expected_samples
        and confirmed == expected_samples
        and not missing_output_files
        and not invalid_ground_truth_files
        and extra_record_count == 0
        and hallucinated_non_null_fields == 0
        and invalid_market_date_source_count == 0
        and all(
        metrics[key] >= threshold for key, threshold in THRESHOLDS.items()
        )
    )
    return {
        "parser": parser,
        "expected_samples": expected_samples,
        "evaluated_samples": evaluated_samples,
        "missing_output_files": missing_output_files,
        "invalid_ground_truth_files": invalid_ground_truth_files,
        "extra_record_count": extra_record_count,
        "hallucinated_non_null_fields": hallucinated_non_null_fields,
        "invalid_market_date_source_count": invalid_market_date_source_count,
        "confirmed_ground_truth_images": confirmed,
        "total_ground_truth_images": len(ground_truth_files),
        "metrics": metrics,
        "thresholds": THRESHOLDS,
        "passed": passed,
        "recommendation": "eligible_for_separate_production_iteration" if passed else "do_not_integrate_production",
        "average_duration_ms": round(sum(durations) / len(durations), 2) if durations else None,
        "peak_memory_mb": max(memories) if memories else None,
        "errors": errors,
    }


def comparison_markdown(evaluations: list[dict[str, Any]]) -> str:
    lines = [
        "# Platts Summary OCR 对照评估",
        "",
        "| 解析器 | 人工真值 | 日期 | 关键数字 | 正负号 | 行列 | 记录召回 | 一致率 | 结论 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for item in evaluations:
        metric = item["metrics"]
        lines.append(
            f"| {item['parser']} | {item['confirmed_ground_truth_images']}/{item['total_ground_truth_images']} "
            f"| {metric['date_accuracy']:.3%} | {metric['critical_numeric_accuracy']:.3%} "
            f"| {metric['sign_accuracy']:.3%} | {metric['row_column_accuracy']:.3%} "
            f"| {metric['record_recall']:.3%} | {metric['repeatability']:.3%} "
            f"| {'通过' if item['passed'] else '不接入生产'} |"
        )
    lines.extend(["", "任何核心指标未达标时，生产链路继续跳过图片。"])
    return "\n".join(lines) + "\n"


def write_error_crops(evaluations: list[dict[str, Any]], samples: Path, output: Path) -> None:
    import cv2

    image_paths = {path.stem: path for path in samples.iterdir() if path.suffix.casefold() in {".jpg", ".jpeg", ".png"}}
    for evaluation in evaluations:
        parser_dir = output / "errors" / evaluation["parser"]
        parser_dir.mkdir(parents=True, exist_ok=True)
        for index, error in enumerate(evaluation["errors"]):
            bbox = error.get("cell_bbox")
            image_path = image_paths.get(error.get("image_id"))
            if not bbox or not image_path or len(bbox) != 4:
                continue
            image = cv2.imread(str(image_path))
            if image is None:
                continue
            left, top, right, bottom = (max(0, int(value)) for value in bbox)
            crop = image[top:bottom, left:right]
            if crop.size:
                cv2.imwrite(str(parser_dir / f"{error['image_id']}_{index:03d}.png"), crop)

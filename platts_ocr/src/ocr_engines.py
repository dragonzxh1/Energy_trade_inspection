"""OCR engines with multi-strategy PSM and preprocessing."""

from __future__ import annotations

import logging
from typing import Any, Optional

import cv2
import numpy as np
import pytesseract

from .image_preprocess import preprocess_strategies
from .parsers import (
    parse_amount,
    parse_change,
    parse_code,
    parse_date,
    parse_mt_bbl,
    parse_spread_value,
)

logger = logging.getLogger(__name__)

# Tesseract config per field type (reduced PSMs for speed)
FIELD_PSM_CONFIG: dict[str, dict[str, Any]] = {
    "code": {
        "psms": [7, 8],
        "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        "parser": parse_code,
    },
    "mid": {
        "psms": [6, 7, 8],
        "whitelist": "0123456789.,-$",
        "parser": parse_amount,
    },
    "change": {
        "psms": [6, 7, 8],
        "whitelist": "0123456789.,-$+",
        "parser": parse_change,
    },
    "extra": {
        "psms": [6, 7, 8],
        "whitelist": "0123456789.,-$+",
        "parser": parse_amount,
    },
    "date": {
        "psms": [6, 7, 11],
        "whitelist": "",
        "parser": parse_date,
    },
    "mt_bbl": {
        "psms": [6, 7, 8],
        "whitelist": "0123456789.",
        "parser": parse_mt_bbl,
    },
}

# Default for spread fields (map short names to number parser)
SPREAD_FIELDS = {"ULSD", "JET", "JET-A1", "Gasoline", "Naphtha", "Gasoil_0.1", "FO_1.0"}


def ocr_field(
    roi_image: np.ndarray,
    field_name: str,
    engine: str = "tesseract",
    fallback_engine: Optional[str] = None,
) -> dict[str, Any]:
    """Run multi-strategy OCR on a single field ROI."""
    # Spread fields use mid config
    if field_name in SPREAD_FIELDS:
        cfg = {"psms": [6, 7, 8], "whitelist": "0123456789.,-$+", "parser": parse_spread_value}
    else:
        cfg = FIELD_PSM_CONFIG.get(field_name, FIELD_PSM_CONFIG["mid"])

    psms: list[int] = cfg.get("psms", [7])
    whitelist: str = cfg.get("whitelist", "")
    parser = cfg.get("parser")

    if roi_image.size == 0:
        return _fail_result("empty_roi")

    # Use only 4 key preprocessing strategies (not all 8) for speed
    strategies = _get_key_strategies(roi_image)
    candidates: list[dict[str, Any]] = []

    for strategy_name, processed in strategies:
        for psm in psms:
            try:
                text, conf = _tesseract_ocr(processed, psm, whitelist)
                if not text or not text.strip():
                    continue
                raw_text = text.strip()
                clean = None
                parse_ok = True
                if parser:
                    try:
                        clean = parser(raw_text)
                        parse_ok = _is_valid_parse(raw_text, clean)
                    except Exception:
                        parse_ok = False
                candidates.append({
                    "strategy": strategy_name,
                    "psm": psm,
                    "raw_text": raw_text,
                    "clean_value": clean,
                    "confidence": conf,
                    "parse_ok": parse_ok,
                })
            except Exception as e:
                logger.debug(f"OCR error [{strategy_name}/psm{psm}]: {e}")

    if not candidates:
        return _fail_result("no_candidates", candidates)

    ok_candidates = [c for c in candidates if c["parse_ok"]]
    if ok_candidates:
        best = max(ok_candidates, key=lambda c: _candidate_score(field_name, c))
    else:
        best = max(candidates, key=lambda c: c["confidence"])
        best["parse_ok"] = False

    if field_name == "change" and isinstance(best.get("clean_value"), (int, float)):
        tint_sign = _infer_change_tint_sign(roi_image)
        if tint_sign:
            best["clean_value"] = tint_sign * abs(float(best["clean_value"]))

    status = "ok" if best["parse_ok"] else "needs_review"

    return {
        "raw_text": best["raw_text"],
        "clean_value": best["clean_value"],
        "confidence": best["confidence"],
        "status": status,
        "candidates": candidates,
        "best_strategy": best["strategy"],
        "best_psm": best["psm"],
    }


def _get_key_strategies(roi_image: np.ndarray) -> list[tuple[str, np.ndarray]]:
    """Return only the 4 most effective preprocessing strategies."""
    all_strategies = preprocess_strategies(roi_image)
    # Keep: gray_original, gray_otsu, gray_sharpened, sharp_otsu
    keep = {"gray_original", "gray_otsu", "gray_sharpened", "sharp_otsu"}
    strategies = [(name, img) for name, img in all_strategies if name in keep]

    gray = cv2.cvtColor(roi_image, cv2.COLOR_BGR2GRAY) if roi_image.ndim == 3 else roi_image
    scaled = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    _, scaled_otsu = cv2.threshold(
        scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
    strategies.extend([
        ("gray_scaled3", scaled),
        ("gray_scaled3_otsu", scaled_otsu),
    ])
    if gray.shape[1] > 60:
        margin = max(4, int(gray.shape[1] * 0.06))
        inner = gray[:, margin:-margin]
        _, inner_otsu = cv2.threshold(
            inner, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        strategies.extend([
            ("gray_inner", inner),
            ("gray_inner_otsu", inner_otsu),
        ])
    return strategies


def _tesseract_ocr(
    img: np.ndarray, psm: int, whitelist: str = ""
) -> tuple[str, float]:
    """Run Tesseract on a preprocessed ROI image."""
    config = f"--psm {psm} -c tessedit_char_whitelist={whitelist}" if whitelist else f"--psm {psm}"
    data = pytesseract.image_to_data(
        img, output_type=pytesseract.Output.DICT, config=config,
    )
    texts: list[str] = []
    confs: list[float] = []
    for i, text in enumerate(data["text"]):
        t = text.strip()
        conf = float(data["conf"][i])
        if t and conf > 0:
            texts.append(t)
            confs.append(conf)
    if not texts:
        fallback_text = pytesseract.image_to_string(img, config=config).strip()
        if fallback_text:
            return fallback_text, 0.0
        return "", -1.0
    combined = " ".join(texts)
    avg_conf = sum(confs) / len(confs) if confs else -1.0
    return combined, round(avg_conf, 1)


def _is_valid_parse(raw_text: str, clean_value: Any) -> bool:
    """Treat None as valid only for explicit N/A-like values."""
    if clean_value is not None:
        return True
    normalized = raw_text.strip().upper().replace(" ", "")
    return normalized in {"N/A", "NA", "N.A", "--"}


def _candidate_score(field_name: str, candidate: dict[str, Any]) -> float:
    """Rank candidates by business plausibility first, confidence second."""
    value = candidate.get("clean_value")
    raw = str(candidate.get("raw_text", ""))
    conf = float(candidate.get("confidence", -1))
    score = conf

    if field_name == "code":
        if isinstance(value, str) and len(value) == 6:
            score += 100
        elif isinstance(value, str):
            score -= 100
        return score

    if field_name in {"mid", "extra"}:
        if isinstance(value, (int, float)):
            if 20 <= float(value) <= 1500:
                score += 200
            else:
                score -= 300
            if "$" in raw:
                score += 20
            if "." in raw or "," in raw:
                score += 20
        return score

    if field_name == "change" or field_name in SPREAD_FIELDS:
        if isinstance(value, (int, float)):
            abs_value = abs(float(value))
            if abs_value <= 100:
                score += 150
            else:
                score -= 250
            if abs_value <= 30:
                score += 40
            if "$" in raw or "." in raw or "," in raw:
                score += 15
        return score

    if field_name == "mt_bbl":
        if isinstance(value, (int, float)):
            numeric = float(value)
            if 5 <= numeric <= 12:
                score += 200
            elif 500 <= numeric <= 1200:
                # OCR may drop the decimal in conversion factors; parser handles
                # normalization separately, but still prefer plausible magnitudes.
                score += 20
            else:
                score -= 100
        return score

    return score


def _infer_change_tint_sign(roi_image: np.ndarray) -> int:
    """Infer sign for change cells from Platts red/green background tint."""
    if roi_image.size == 0 or roi_image.ndim != 3:
        return 0

    # Ignore dark glyph pixels and focus on the light colored cell background.
    bgr = roi_image.reshape(-1, 3).astype(np.float32)
    light = bgr[np.min(bgr, axis=1) > 120]
    if light.size == 0:
        light = bgr

    b, g, r = np.mean(light, axis=0)
    if r - g > 8 and r - b > 8:
        return -1
    if g - r > 8 and g - b > 8:
        return 1
    return 0


def _fail_result(
    reason: str, candidates: Optional[list[dict[str, Any]]] = None
) -> dict[str, Any]:
    return {
        "raw_text": "",
        "clean_value": None,
        "confidence": -1.0,
        "status": "failed",
        "candidates": candidates or [],
        "fail_reason": reason,
    }

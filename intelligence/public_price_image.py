"""Create a lossless, branded public price-reference image."""

from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


EXPECTED_PROMO_ROI = (932, 344, 1280, 524)
EXPECTED_QR_URL = "http://weixin.qq.com/r/mp/jDgnPxzEDUFyrVhc922e"
PROMO_DETECTION_VERSION = "green-cards.v1"


class PublicPriceImageError(RuntimeError):
    """Raised when a public price-reference image cannot be safely created."""


@dataclass(frozen=True, slots=True)
class PublicImageResult:
    source_path: str
    output_path: str
    source_sha256: str
    output_sha256: str
    qr_sha256: str
    promo_roi: tuple[int, int, int, int]
    template_version: str
    qr_decoded_url: str


def create_public_price_image(
    source_path: Path,
    qr_path: Path,
    output_path: Path,
    config: dict[str, Any],
) -> PublicImageResult:
    """Create a PNG that changes pixels only in the configured promotion ROI."""
    source_path = Path(source_path)
    qr_path = Path(qr_path)
    output_path = Path(output_path)
    manifest_path = output_path.with_name(f"{output_path.stem}_transform.json")

    _validate_output_paths(output_path, manifest_path)
    source = _read_source(source_path, config)
    promo_roi = _read_promo_roi(config, source=source)
    qr_image = _read_and_validate_qr(qr_path)
    fonts = _load_fonts(config)
    rendered = _render_promotion(source, promo_roi, qr_image, config, fonts)
    decoded_url = _decode_qr(rendered)
    if decoded_url != EXPECTED_QR_URL:
        raise PublicPriceImageError("Rendered image QR code does not match the required URL")

    encoded_png = _encode_png(rendered)
    result = PublicImageResult(
        source_path=str(source_path),
        output_path=str(output_path),
        source_sha256=_sha256_file(source_path),
        output_sha256=_sha256_bytes(encoded_png),
        qr_sha256=_sha256_file(qr_path),
        promo_roi=promo_roi,
        template_version=_required_string(config, "template_version"),
        qr_decoded_url=decoded_url,
    )
    manifest = json.dumps(asdict(result), ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    _write_artifacts_atomically(output_path, encoded_png, manifest_path, manifest)
    return result


def validate_public_price_image(
    output_path: Path,
    config: dict[str, Any],
    *,
    expected_source_sha256: str,
    source_path: Path,
    qr_path: Path,
) -> PublicImageResult:
    output_path = Path(output_path)
    manifest_path = output_path.with_name(f"{output_path.stem}_transform.json")
    if not output_path.is_file() or not manifest_path.is_file():
        raise PublicPriceImageError("Public reference image or transform manifest is missing")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PublicPriceImageError("Public reference transform manifest is invalid") from error
    if not isinstance(manifest, dict):
        raise PublicPriceImageError("Public reference transform manifest is invalid")

    source_path = Path(source_path)
    if not source_path.is_file() or _sha256_file(source_path) != expected_source_sha256:
        raise PublicPriceImageError("Public reference immutable source image mismatch")
    source = _read_source(source_path, config)
    expected_roi = _read_promo_roi(config, source=source)
    expected_template = _required_string(config, "template_version")
    checks = {
        "source_sha256": expected_source_sha256,
        "qr_sha256": _sha256_file(Path(qr_path)),
        "output_sha256": _sha256_file(output_path),
        "template_version": expected_template,
        "qr_decoded_url": EXPECTED_QR_URL,
    }
    for key, expected in checks.items():
        if manifest.get(key) != expected:
            raise PublicPriceImageError(f"Public reference manifest {key} mismatch")
    if tuple(manifest.get("promo_roi", ())) != expected_roi:
        raise PublicPriceImageError("Public reference manifest promotion ROI mismatch")

    image = cv2.imread(str(output_path), cv2.IMREAD_COLOR)
    if image is None or source is None:
        raise PublicPriceImageError("Public reference PNG or immutable source cannot be decoded")
    expected_size = (source.shape[1], source.shape[0])
    if (image.shape[1], image.shape[0]) != expected_size:
        raise PublicPriceImageError("Public reference PNG dimensions mismatch")
    if source.shape != image.shape:
        raise PublicPriceImageError("Public reference PNG and immutable source dimensions mismatch")
    left, top, right, bottom = expected_roi
    outside = np.ones(source.shape[:2], dtype=bool)
    outside[top:bottom, left:right] = False
    if not np.array_equal(source[outside], image[outside]):
        raise PublicPriceImageError("Public reference pixels outside the promotion ROI changed")
    if _decode_qr(image) != EXPECTED_QR_URL:
        raise PublicPriceImageError("Public reference PNG QR code mismatch")

    try:
        return PublicImageResult(
            source_path=str(manifest["source_path"]),
            output_path=str(output_path),
            source_sha256=str(manifest["source_sha256"]),
            output_sha256=str(manifest["output_sha256"]),
            qr_sha256=str(manifest["qr_sha256"]),
            promo_roi=expected_roi,
            template_version=str(manifest["template_version"]),
            qr_decoded_url=str(manifest["qr_decoded_url"]),
        )
    except KeyError as error:
        raise PublicPriceImageError("Public reference transform manifest is incomplete") from error


def _validate_output_paths(output_path: Path, manifest_path: Path) -> None:
    if output_path.suffix.lower() != ".png":
        raise PublicPriceImageError("Public reference output must use the .png extension")
    if not output_path.parent.is_dir():
        raise PublicPriceImageError("Output directory does not exist")
    if output_path.exists() or manifest_path.exists():
        raise PublicPriceImageError("Refusing to replace an existing public reference artifact")


def _read_promo_roi(
    config: dict[str, Any], *, source: np.ndarray,
) -> tuple[int, int, int, int]:
    detected = _detect_promotion_roi(source)
    if detected is not None:
        return detected
    raw_roi = config.get("promo_roi")
    if not isinstance(raw_roi, list) or len(raw_roi) != 4:
        raise PublicPriceImageError("Promotion ROI configuration is invalid")
    try:
        promo_roi = tuple(int(value) for value in raw_roi)
    except (TypeError, ValueError) as error:
        raise PublicPriceImageError("Promotion ROI configuration is invalid") from error
    normalized = config.get("normalized_promo_roi")
    height, width = source.shape[:2]
    if not (1200 <= width <= 1320 and 500 <= height <= 600):
        raise PublicPriceImageError(
            "Promotion cards could not be detected for this image layout"
        )
    if isinstance(normalized, list) and len(normalized) == 4:
        try:
            left, top, right, bottom = (
                int(round(float(value) * size))
                for value, size in zip(normalized, (width, height, width, height))
            )
            if 0 <= left < right <= width and 0 <= top < bottom <= height:
                return left, top, right, bottom
        except (TypeError, ValueError):
            pass
    scale_x = width / EXPECTED_PROMO_ROI[2]
    scale_y = height / EXPECTED_PROMO_ROI[3]
    left = max(0, int(round(promo_roi[0] * scale_x)))
    top = max(0, int(round(promo_roi[1] * scale_y)))
    return left, top, width, height


def _detect_promotion_roi(source: np.ndarray) -> tuple[int, int, int, int] | None:
    """Locate the two green promotion cards without depending on image dimensions."""
    height, width = source.shape[:2]
    hsv = cv2.cvtColor(source, cv2.COLOR_BGR2HSV)
    search_left = int(width * 0.68)
    search_top = int(height * 0.54)
    search = hsv[search_top:, search_left:]
    saturated = ((search[:, :, 1] > 35) & (search[:, :, 2] > 75)).astype(np.uint8) * 255
    saturated = cv2.morphologyEx(
        saturated, cv2.MORPH_CLOSE, np.ones((9, 9), dtype=np.uint8),
    )
    component_count, _, statistics, _ = cv2.connectedComponentsWithStats(saturated)
    candidates: list[tuple[int, int, int, int, int]] = []
    for x, y, component_width, component_height, area in statistics[1:component_count]:
        absolute_x = int(x) + search_left
        absolute_y = int(y) + search_top
        if (
            area >= width * height * 0.012
            and component_width >= width * 0.08
            and component_height >= height * 0.25
        ):
            candidates.append((absolute_x, absolute_y, int(component_width), int(component_height), int(area)))
    candidates.sort(key=lambda item: item[4], reverse=True)
    if len(candidates) < 2:
        return None
    cards = sorted(candidates[:2], key=lambda item: item[0])
    if cards[1][0] - cards[0][0] < width * 0.09:
        return None
    left = max(0, min(card[0] for card in cards) - max(8, int(width * 0.007)))
    top = max(0, min(card[1] for card in cards) - max(10, int(height * 0.018)))
    right = width
    bottom = height
    if left < width * 0.68 or top < height * 0.55:
        return None
    return left, top, right, bottom


def _read_source(source_path: Path, config: dict[str, Any]) -> np.ndarray:
    source = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    if source is None:
        raise PublicPriceImageError("Source image cannot be read")
    expected_width = _required_int(config, "expected_width")
    minimum_width = int(config.get("minimum_width", round(expected_width * 0.96)))
    maximum_width = int(config.get("maximum_width", round(expected_width * 1.02)))
    minimum_height = _required_int(config, "minimum_height")
    maximum_height = _required_int(config, "maximum_height")
    minimum_aspect_ratio = float(config.get("minimum_aspect_ratio", 2.0))
    maximum_aspect_ratio = float(config.get("maximum_aspect_ratio", 2.7))
    height, width = source.shape[:2]
    if not minimum_width <= width <= maximum_width:
        raise PublicPriceImageError(
            f"Source width must be between {minimum_width} and {maximum_width} pixels, got {width}"
        )
    if not minimum_height <= height <= maximum_height:
        raise PublicPriceImageError(
            f"Source height must be between {minimum_height} and {maximum_height} pixels, got {height}"
        )
    aspect_ratio = width / height
    if not minimum_aspect_ratio <= aspect_ratio <= maximum_aspect_ratio:
        raise PublicPriceImageError(
            "Source aspect ratio is outside the supported Platts Summary layout"
        )
    return source


def _read_and_validate_qr(qr_path: Path) -> Image.Image:
    if not qr_path.is_file():
        raise PublicPriceImageError("QR image does not exist")
    try:
        with Image.open(qr_path) as opened_qr:
            qr_image = opened_qr.convert("RGB")
    except (OSError, ValueError) as error:
        raise PublicPriceImageError("QR image cannot be read") from error
    decoded_url = _decode_qr(cv2.cvtColor(np.asarray(qr_image), cv2.COLOR_RGB2BGR))
    if decoded_url != EXPECTED_QR_URL:
        raise PublicPriceImageError("QR image does not encode the required URL")
    return qr_image


def _load_fonts(config: dict[str, Any]) -> dict[str, ImageFont.FreeTypeFont]:
    candidates = config.get("font_candidates")
    if not isinstance(candidates, list):
        raise PublicPriceImageError("Font candidate configuration is invalid")
    for candidate in candidates:
        if not isinstance(candidate, str) or not Path(candidate).is_file():
            continue
        try:
            return {
                "title": ImageFont.truetype(candidate, 27),
                "subtitle": ImageFont.truetype(candidate, 17),
                "action": ImageFont.truetype(candidate, 17),
                "label": ImageFont.truetype(candidate, 13),
            }
        except OSError:
            continue
    raise PublicPriceImageError("No configured Chinese font is available")


def _render_promotion(
    source: np.ndarray,
    promo_roi: tuple[int, int, int, int],
    qr_image: Image.Image,
    config: dict[str, Any],
    fonts: dict[str, ImageFont.FreeTypeFont],
) -> np.ndarray:
    left, top, right, bottom = promo_roi
    canvas = Image.fromarray(cv2.cvtColor(source, cv2.COLOR_BGR2RGB))
    panel = Image.new("RGB", (right - left, bottom - top), (247, 252, 249))
    draw = ImageDraw.Draw(panel)
    panel_width, panel_height = right - left, bottom - top
    margin = max(8, int(min(panel_width, panel_height) * 0.045))
    qr_size = min(156, panel_height - margin * 2)
    if qr_size < 120 or panel_width < qr_size + 145:
        raise PublicPriceImageError("Detected promotion area is too small for a readable QR code")
    qr_origin = (margin, (panel_height - qr_size) // 2)
    relative_card = (
        qr_origin[0] - 4, qr_origin[1] - 4,
        qr_origin[0] + qr_size + 4, qr_origin[1] + qr_size + 4,
    )
    draw.rounded_rectangle(relative_card, radius=10, fill=(255, 255, 255), outline=(187, 220, 210), width=1)
    resized_qr = qr_image.resize((qr_size, qr_size), Image.Resampling.NEAREST)
    panel.paste(resized_qr, qr_origin)

    text_x = qr_origin[0] + qr_size + max(14, margin)
    draw.text((text_x, margin + 4), _required_string(config, "brand_title"), font=fonts["title"], fill=(0, 127, 111))
    draw.text((text_x, margin + 48), _required_string(config, "brand_subtitle"), font=fonts["subtitle"], fill=(33, 45, 56))
    draw.text((text_x, margin + 83), _required_string(config, "brand_action"), font=fonts["action"], fill=(33, 45, 56))
    draw.text((text_x, margin + 119), _required_string(config, "label"), font=fonts["label"], fill=(111, 128, 139))
    canvas.paste(panel, (left, top))
    return cv2.cvtColor(np.asarray(canvas), cv2.COLOR_RGB2BGR)


def _decode_qr(image: np.ndarray) -> str:
    decoded_url, _, _ = cv2.QRCodeDetector().detectAndDecode(image)
    return decoded_url


def _encode_png(image: np.ndarray) -> bytes:
    png = io.BytesIO()
    Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).save(png, format="PNG", compress_level=9)
    return png.getvalue()


def _write_artifacts_atomically(
    output_path: Path,
    encoded_png: bytes,
    manifest_path: Path,
    manifest: bytes,
) -> None:
    temporary_paths: list[Path] = []
    output_written = False
    try:
        output_temporary = _write_temporary_file(output_path.parent, encoded_png)
        temporary_paths.append(output_temporary)
        manifest_temporary = _write_temporary_file(manifest_path.parent, manifest)
        temporary_paths.append(manifest_temporary)
        os.replace(output_temporary, output_path)
        temporary_paths.remove(output_temporary)
        output_written = True
        os.replace(manifest_temporary, manifest_path)
        temporary_paths.remove(manifest_temporary)
    except OSError as error:
        if output_written:
            output_path.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        raise PublicPriceImageError("Failed to atomically write public reference artifacts") from error
    finally:
        for temporary_path in temporary_paths:
            temporary_path.unlink(missing_ok=True)


def _write_temporary_file(directory: Path, contents: bytes) -> Path:
    descriptor, temporary_name = tempfile.mkstemp(prefix=".public-reference-", suffix=".tmp", dir=directory)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as temporary_file:
            temporary_file.write(contents)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
    except OSError:
        temporary_path.unlink(missing_ok=True)
        raise
    return temporary_path


def _required_string(config: dict[str, Any], key: str) -> str:
    value = config.get(key)
    if not isinstance(value, str) or not value:
        raise PublicPriceImageError(f"{key} configuration is invalid")
    return value


def _required_int(config: dict[str, Any], key: str) -> int:
    value = config.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise PublicPriceImageError(f"{key} configuration is invalid")
    return value


def _required_box(config: dict[str, Any], key: str) -> tuple[int, int, int, int]:
    value = config.get(key)
    if not isinstance(value, list) or len(value) != 4 or any(not isinstance(item, int) for item in value):
        raise PublicPriceImageError(f"{key} configuration is invalid")
    return tuple(value)


def _required_pair(config: dict[str, Any], key: str) -> tuple[int, int]:
    value = config.get(key)
    if not isinstance(value, list) or len(value) != 2 or any(not isinstance(item, int) for item in value):
        raise PublicPriceImageError(f"{key} configuration is invalid")
    return tuple(value)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_bytes(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()

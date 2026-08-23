"""Image preprocessing for Platts OCR pipeline.

Handles: scale up, grayscale, denoise, binarize (Otsu + adaptive),
sharpen, deskew, border detection, and perspective alignment.
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_and_preprocess(
    path: str,
    scale: int = 3,
    deskew: bool = True,
    align_to_template: bool = True,
    template_size: Optional[Tuple[int, int]] = None,
    align_mode: str = "border-resize",
) -> np.ndarray:
    """Load an image and run the full preprocessing pipeline.

    Returns a BGR image ready for ROI cropping.
    """
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {path}")

    logger.info(f"Loaded: {path}  shape={img.shape}")

    if deskew:
        img = auto_deskew(img)

    if align_mode == "border-resize":
        img = crop_to_content_border(img)

    if scale != 1:
        img = scale_up(img, factor=scale)

    if align_to_template and template_size:
        if align_mode in ("resize", "border-resize"):
            img = resize_to_size(img, template_size)
        elif align_mode == "perspective":
            img = align_to_size(img, template_size)
        elif align_mode == "none":
            pass
        else:
            raise ValueError(f"Unsupported align_mode: {align_mode}")

    return img


def scale_up(img: np.ndarray, factor: int = 3) -> np.ndarray:
    """Scale up image by integer factor using INTER_CUBIC."""
    h, w = img.shape[:2]
    return cv2.resize(img, (w * factor, h * factor), interpolation=cv2.INTER_CUBIC)


def resize_to_size(img: np.ndarray, template_size: Tuple[int, int]) -> np.ndarray:
    """Resize image to template dimensions without trying perspective detection."""
    tw, th = template_size
    resized = cv2.resize(img, (tw, th), interpolation=cv2.INTER_CUBIC)
    logger.info(f"Resized to {tw}x{th}")
    return resized


def crop_to_content_border(
    img: np.ndarray,
    dark_threshold: int = 110,
    min_coverage: float = 0.60,
    pad: int = 2,
) -> np.ndarray:
    """Crop to the outer Platts page border/content box.

    Screenshots may include a few pixels of jitter, browser chrome remnants, or
    inconsistent margins. This keeps template coordinates stable without asking
    OCR to infer table structure.
    """
    gray = to_gray(img)
    dark = gray < dark_threshold
    ys, xs = np.where(dark)
    if xs.size == 0 or ys.size == 0:
        logger.warning("No dark pixels found, skipping border crop")
        return img

    h, w = img.shape[:2]
    x1, x2 = int(xs.min()), int(xs.max())
    y1, y2 = int(ys.min()), int(ys.max())

    width_coverage = (x2 - x1 + 1) / w
    height_coverage = (y2 - y1 + 1) / h
    if width_coverage < min_coverage or height_coverage < min_coverage:
        logger.warning(
            "Detected content border too small "
            f"({width_coverage:.2f}x{height_coverage:.2f}), skipping border crop"
        )
        return img

    x1 = max(0, x1 - pad)
    y1 = max(0, y1 - pad)
    x2 = min(w - 1, x2 + pad)
    y2 = min(h - 1, y2 + pad)

    cropped = img[y1:y2 + 1, x1:x2 + 1]
    logger.info(
        f"Border crop: [{x1},{y1},{x2},{y2}] "
        f"{img.shape[1]}x{img.shape[0]} -> {cropped.shape[1]}x{cropped.shape[0]}"
    )
    return cropped


def mask_relative_regions(
    img: np.ndarray,
    regions: list[dict[str, object]],
    fill: tuple[int, int, int] = (255, 255, 255),
) -> np.ndarray:
    """Mask configured relative regions, usually QR/ad blocks, with white."""
    if not regions:
        return img

    masked = img.copy()
    h, w = masked.shape[:2]
    for region in regions:
        bbox_obj = region.get("bbox") if isinstance(region, dict) else None
        if not isinstance(bbox_obj, list) or len(bbox_obj) != 4:
            continue
        x1 = max(0, min(w, int(float(bbox_obj[0]) * w)))
        y1 = max(0, min(h, int(float(bbox_obj[1]) * h)))
        x2 = max(0, min(w, int(float(bbox_obj[2]) * w)))
        y2 = max(0, min(h, int(float(bbox_obj[3]) * h)))
        if x2 <= x1 or y2 <= y1:
            continue
        masked[y1:y2, x1:x2] = fill
        logger.debug(f"Masked region {region.get('id', 'unnamed')}: [{x1},{y1},{x2},{y2}]")
    return masked


def auto_deskew(img: np.ndarray, max_angle: float = 2.0) -> np.ndarray:
    """Detect and correct slight skew in the image."""
    gray = to_gray(img)
    # Use edges to find the dominant line angle
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=100)
    if lines is None:
        return img

    angles: list[float] = []
    for rho, theta in lines[:, 0]:
        angle = np.rad2deg(theta) - 90
        if abs(angle) < max_angle:
            angles.append(angle)

    if not angles:
        return img

    median_angle = float(np.median(angles))
    if abs(median_angle) < 0.3:
        return img

    logger.info(f"Deskew angle: {median_angle:.2f} deg")
    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
    rotated = cv2.warpAffine(
        img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    return rotated


def align_to_size(
    img: np.ndarray, template_size: Tuple[int, int]
) -> np.ndarray:
    """Perspective-align image to match template dimensions.

    Detects the outermost rectangular border of the table and
    warps it to fill template_size.
    """
    gray = to_gray(img)
    # Find the largest contour that's roughly rectangular
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 5
    )

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        logger.warning("No contours found, skipping alignment")
        return img

    # Find the largest contour with 4 points after approx
    best: Optional[np.ndarray] = None
    best_area = 0.0
    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        area = cv2.contourArea(approx)
        if len(approx) == 4 and area > best_area:
            best = approx
            best_area = area

    if best is None:
        logger.warning("No 4-point contour found, skipping alignment")
        return img

    # Order points: top-left, top-right, bottom-right, bottom-left
    pts = best.reshape(4, 2).astype(np.float32)
    ordered = _order_points(pts)

    tw, th = template_size
    dst = np.float32([[0, 0], [tw, 0], [tw, th], [0, th]])

    M = cv2.getPerspectiveTransform(ordered, dst)
    warped = cv2.warpPerspective(img, M, (tw, th), flags=cv2.INTER_CUBIC)
    logger.info(f"Aligned to {tw}x{th}")
    return warped


# ---------------------------------------------------------------------------
# Preprocessing strategies for individual ROIs
# ---------------------------------------------------------------------------

def to_gray(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def preprocess_strategies(img: np.ndarray) -> list[tuple[str, np.ndarray]]:
    """Generate multiple preprocessed versions of a small ROI image.

    Returns list of (strategy_name, processed_image).
    All strategies assume the input is already a small cropped ROI
    (grayscale or BGR).
    """
    gray = to_gray(img)
    results: list[tuple[str, np.ndarray]] = []

    # Strategy 1: Original grayscale
    results.append(("gray_original", gray))

    # Strategy 2: Otsu binarization
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    results.append(("gray_otsu", otsu))

    # Strategy 3: Adaptive threshold (Gaussian)
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 3
    )
    results.append(("gray_adaptive", adaptive))

    # Strategy 4: Adaptive threshold (Mean)
    adaptive_mean = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, 3
    )
    results.append(("gray_adaptive_mean", adaptive_mean))

    # Strategy 5: Sharpened
    kernel = np.array([[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]])
    sharpened = cv2.filter2D(gray, -1, kernel)
    results.append(("gray_sharpened", sharpened))

    # Strategy 6: Sharpened + Otsu
    _, sharp_otsu = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    results.append(("sharp_otsu", sharp_otsu))

    # Strategy 7: Inverted (white text on black)
    inverted = cv2.bitwise_not(gray)
    results.append(("inverted", inverted))

    # Strategy 8: Inverted + Otsu
    _, inv_otsu = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    results.append(("inv_otsu", inv_otsu))

    return results


def detect_border(img: np.ndarray) -> Optional[np.ndarray]:
    """Detect the outermost rectangular border. Returns 4 corner points."""
    gray = to_gray(img)
    edges = cv2.Canny(gray, 30, 100)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best: Optional[np.ndarray] = None
    best_area = 0.0
    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) == 4:
            area = cv2.contourArea(approx)
            if area > best_area:
                best = approx
                best_area = area

    return best


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as [top-left, top-right, bottom-right, bottom-left]."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # top-left
    rect[2] = pts[np.argmax(s)]  # bottom-right
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # top-right
    rect[3] = pts[np.argmax(diff)]  # bottom-left
    return rect

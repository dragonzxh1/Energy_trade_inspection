"""Isolated PaddleOCR-VL trial for image-only PDFs; never feeds the report pipeline."""
import argparse
import base64
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from daily_report import REPORTS_DIR, load_project_env, strip_think_tags


load_project_env(Path(__file__).parent.parent / ".env.local")

XFYUN_BASE_URL = os.getenv("XFYUN_MAAS_BASE_URL", "https://maas-api.cn-huabei-1.xf-yun.com/v2")
XFYUN_API_KEY = os.getenv("XFYUN_MAAS_API_KEY", "")
XFYUN_MODEL_ID = os.getenv("XFYUN_PADDLEOCR_MODEL_ID", "")
XFYUN_PRICE_PER_MILLION = float(os.getenv("XFYUN_OCR_PRICE_PER_MILLION_TOKENS", "0"))


def post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {XFYUN_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body[:1000]}") from exc


def render_pdf_pages(path: Path, page_limit: int) -> tuple[int, list[tuple[int, bytes]]]:
    import fitz

    document = fitz.open(str(path))
    extracted_chars = sum(len(page.get_text().strip()) for page in document)
    pages: list[tuple[int, bytes]] = []
    for page_index in range(min(len(document), page_limit)):
        page = document[page_index]
        scale = min(2.0, 2200 / max(page.rect.width, page.rect.height))
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        pages.append((page_index + 1, pixmap.tobytes("jpeg", jpg_quality=82)))
    document.close()
    return extracted_chars, pages


def ocr_page(image_bytes: bytes) -> tuple[str, dict[str, Any]]:
    image_url = "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode("ascii")
    response = post_json(
        XFYUN_BASE_URL.rstrip("/") + "/chat/completions",
        {
            "model": XFYUN_MODEL_ID,
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "识别页面中全部可见文字，保持阅读顺序、段落、数字和单位。不要总结、翻译或补写，只输出识别文本。",
                    },
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }],
            "temperature": 0,
            "max_tokens": 8192,
        },
    )
    text = str(strip_think_tags(response.get("choices", [{}])[0].get("message", {}).get("content", ""))).strip()
    return text, response.get("usage", {}) if isinstance(response.get("usage"), dict) else {}


def count_energy_paragraphs(text: str) -> int:
    keywords = (
        "oil", "gas", "lng", "crude", "refinery", "energy", "fuel", "tanker",
        "石油", "天然气", "原油", "炼厂", "能源", "燃料", "油轮",
    )
    paragraphs = [paragraph.strip() for paragraph in text.split("\n") if paragraph.strip()]
    return sum(any(keyword in paragraph.lower() for keyword in keywords) for paragraph in paragraphs)


def run_trial(path: Path, output_dir: Path, page_limit: int) -> dict[str, Any]:
    started = time.perf_counter()
    result: dict[str, Any] = {
        "file": str(path),
        "model_id": XFYUN_MODEL_ID,
        "base_url": XFYUN_BASE_URL,
        "page_limit": page_limit,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "production_pipeline_affected": False,
        "pages": [],
    }
    try:
        extracted_chars, pages = render_pdf_pages(path, page_limit)
        result["existing_text_chars"] = extracted_chars
        if extracted_chars >= 500:
            result.update({"status": "skipped", "reason": "PDF already has a usable text layer"})
            return result
        total_tokens = 0
        combined_text: list[str] = []
        for page_number, image_bytes in pages:
            page_started = time.perf_counter()
            text, usage = ocr_page(image_bytes)
            page_tokens = int(usage.get("total_tokens", 0) or 0)
            total_tokens += page_tokens
            combined_text.append(text)
            result["pages"].append({
                "page": page_number,
                "text_chars": len(text),
                "energy_paragraphs": count_energy_paragraphs(text),
                "elapsed_seconds": round(time.perf_counter() - page_started, 3),
                "usage": usage,
            })
        full_text = "\n\n".join(combined_text)
        text_path = output_dir / f"{path.stem}_ocr.txt"
        text_path.write_text(full_text, encoding="utf-8")
        result.update({
            "status": "success",
            "ocr_text_path": str(text_path),
            "ocr_text_chars": len(full_text),
            "energy_paragraphs": count_energy_paragraphs(full_text),
            "total_tokens": total_tokens,
            "estimated_cost": round(total_tokens * XFYUN_PRICE_PER_MILLION / 1_000_000, 6),
            "price_per_million_tokens": XFYUN_PRICE_PER_MILLION,
        })
    except Exception as exc:
        result.update({"status": "error", "error": str(exc)})
    finally:
        result["elapsed_seconds"] = round(time.perf_counter() - started, 3)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Run an isolated PaddleOCR-VL trial")
    parser.add_argument("files", nargs="+", help="One or two image-only PDF files")
    parser.add_argument("--pages", type=int, default=2, help="Maximum pages per PDF")
    parser.add_argument("--output-dir", default=str(REPORTS_DIR / "ocr_trials"))
    args = parser.parse_args()
    if len(args.files) > 2:
        raise ValueError("OCR trial accepts at most two files")
    if not XFYUN_API_KEY or not XFYUN_MODEL_ID:
        raise RuntimeError("Set XFYUN_MAAS_API_KEY and XFYUN_PADDLEOCR_MODEL_ID before running the OCR trial")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    results = [run_trial(Path(file_name), output_dir, max(1, args.pages)) for file_name in args.files]
    summary_path = output_dir / f"trial_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    summary_path.write_text(json.dumps({"results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"summary_path": str(summary_path), "results": results}, ensure_ascii=False, indent=2))
    if any(result.get("status") == "error" for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()

import argparse
import json
import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
VAULT = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
REPORTS_DIR = VAULT / "reports"
QUALITY_DIR = REPORTS_DIR / "quality"
WECHAT_DIR = REPORTS_DIR / "wechat_publish"
WECHAT_CONFIG_PATH = Path(os.getenv("WECHAT_MP_CONFIG", ROOT_DIR / "intelligence" / "wechat_publish.json"))


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_auto_mode() -> str:
    env_mode = os.getenv("WECHAT_MP_AUTO_MODE", "").strip().lower()
    if env_mode:
        return env_mode
    config = load_json(WECHAT_CONFIG_PATH)
    return str(config.get("auto_mode", "off")).strip().lower() or "off"


def check_date(target_date: str) -> dict:
    md_path = REPORTS_DIR / f"{target_date}.md"
    html_path = REPORTS_DIR / f"{target_date}_wechat.html"
    summary_path = REPORTS_DIR / f"{target_date}_summary.txt"
    quality_path = QUALITY_DIR / f"{target_date}.json"
    llm_review_path = QUALITY_DIR / f"{target_date}_llm_review.json"
    draft_path = WECHAT_DIR / f"{target_date}_draft.json"
    publish_path = WECHAT_DIR / f"{target_date}_publish.json"
    preview_path = WECHAT_DIR / f"{target_date}_draft_preview.html"
    payload_path = WECHAT_DIR / f"{target_date}_draft_payload.json"
    publish_preview_path = WECHAT_DIR / f"{target_date}_publish_preview.html"
    publish_payload_path = WECHAT_DIR / f"{target_date}_publish_payload.json"
    rollout_path = WECHAT_DIR / "rollout_state.json"

    quality = load_json(quality_path)
    llm_review = load_json(llm_review_path)
    draft = load_json(draft_path)
    publish = load_json(publish_path)
    auto_mode = resolve_auto_mode()
    publishable = quality.get("publishable", True) is not False
    publish_reason = str(quality.get("publish_reason", "")).strip()

    ok = True
    issues: list[str] = []
    warnings: list[str] = []
    if not md_path.exists():
        ok = False
        issues.append("missing markdown")
    if not html_path.exists():
        ok = False
        issues.append("missing wechat html")
    if not summary_path.exists():
        warnings.append("missing summary")
    if not quality_path.exists():
        ok = False
        issues.append("missing quality audit")
    elif quality.get("status") != "pass":
        ok = False
        issues.append(f"quality={quality.get('status')}")
    if publishable:
        preview_exists = preview_path.exists() or publish_preview_path.exists()
        payload_exists = payload_path.exists() or publish_payload_path.exists()
        if not preview_exists:
            warnings.append("missing wechat draft preview")
        if not payload_exists:
            warnings.append("missing wechat draft payload")
        if llm_review.get("status") != "pass":
            ok = False
            issues.append(f"llm_review={llm_review.get('status', 'missing')}")
        if auto_mode in {"auto", "draft", "publish"} and not draft.get("media_id") and not publish.get("media_id"):
            ok = False
            issues.append(f"wechat {auto_mode} mode enabled but draft media_id missing")
        if auto_mode == "publish" and not publish.get("publish_id"):
            ok = False
            issues.append("wechat publish mode enabled but publish_id missing")

    return {
        "date": target_date,
        "ok": ok,
        "issues": issues,
        "warnings": warnings,
        "markdown": str(md_path),
        "html": str(html_path),
        "quality_status": quality.get("status", "missing"),
        "llm_review_status": llm_review.get("status", "missing"),
        "publishable": publishable,
        "publish_reason": publish_reason,
        "wechat_auto_mode": auto_mode,
        "draft_media_id": draft.get("media_id", ""),
        "publish_id": publish.get("publish_id", ""),
        "preview_html": str(preview_path),
        "payload_json": str(payload_path),
        "preview_exists": preview_path.exists() or publish_preview_path.exists(),
        "payload_exists": payload_path.exists() or publish_payload_path.exists(),
        "rollout_state": load_json(rollout_path),
    }


def render_markdown(result: dict) -> str:
    status = "通过" if result.get("ok") else "告警"
    lines = [
        f"# 日报健康检查｜{result['date']}",
        "",
        f"- 状态：{status}",
        f"- Markdown：`{result['markdown']}`",
        f"- WeChat HTML：`{result['html']}`",
        f"- 质量状态：`{result['quality_status']}`",
        f"- 公众号发布：`{'是' if result.get('publishable', True) else '否（仅本地存档）'}`",
        f"- 公众号自动模式：`{result.get('wechat_auto_mode', 'off')}`",
        f"- 草稿媒体 ID：`{result.get('draft_media_id', '') or '-'}`",
        f"- 发布 ID：`{result.get('publish_id', '') or '-'}`",
        f"- 预览 HTML：`{result.get('preview_html', '')}`",
        f"- Payload JSON：`{result.get('payload_json', '')}`",
    ]
    issues = result.get("issues", [])
    warnings = result.get("warnings", [])
    if issues:
        lines.extend(["", "## 问题"])
        for issue in issues:
            lines.append(f"- {issue}")
    if warnings:
        lines.extend(["", "## 提醒"])
        for warning in warnings:
            lines.append(f"- {warning}")
    if not issues and not warnings:
        lines.extend(["", "## 结果", "- 未发现结构化健康问题"])
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Check ETI daily report pipeline health")
    parser.add_argument("--date", required=True, help="Target date, e.g. 2026-07-09")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    parser.add_argument("--output", help="Optional output path")
    args = parser.parse_args()
    result = check_date(args.date)
    if args.format == "markdown":
        rendered = render_markdown(result)
    else:
        rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    print(rendered)
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()

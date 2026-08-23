"""Compose independently approved Summary and Digital drafts into one daily edition."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from intelligence.telegram_notify import NotificationEvent, emit_event
from intelligence.wechat_publish import (
    DEFAULT_CONFIG_PATH,
    REPORTS_DIR,
    clean_text,
    create_multi_article_draft,
    get_access_token,
    read_publish_config,
    submit_publish,
    verify_created_multi_article_draft,
    wait_publish_result,
)


MAX_BUNDLE_ARTICLES = 8
CURRENT_DIGIT_STATUSES = {"draft_created", "published"}


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _component_from_payload(
    payload_path: Path,
    state_path: Path,
    *,
    stream: str,
    market_date: str,
) -> dict[str, Any] | None:
    if not payload_path.is_file() or not state_path.is_file():
        return None
    state = _load_json(state_path)
    verification = state.get("draft_verification")
    if state.get("ok") is not True or not isinstance(verification, dict):
        return None
    if verification.get("verified") is not True:
        return None
    article = _load_json(payload_path)
    required = ("title", "content", "thumb_media_id")
    if any(not clean_text(article.get(field)) for field in required):
        return None
    article.update({
        "author": "能见社",
        "digest": clean_text(article.get("digest")),
        "content_source_url": clean_text(article.get("content_source_url")),
        "need_open_comment": int(article.get("need_open_comment") or 0),
        "only_fans_can_comment": int(article.get("only_fans_can_comment") or 0),
        "market_date": market_date,
        "stream": stream,
        "component_media_id": clean_text(state.get("media_id")),
        "component_payload_path": str(payload_path),
        "article_image_url": clean_text(state.get("article_image_url")),
    })
    return article


def _current_digit_slugs(reports_root: Path, market_date: str) -> set[str]:
    index_path = reports_root / "digit" / market_date / "index.json"
    if not index_path.is_file():
        return set()
    payload = _load_json(index_path)
    return {
        clean_text(article.get("article_slug"))
        for article in payload.get("articles", [])
        if isinstance(article, dict)
        and clean_text(article.get("article_slug"))
        and article.get("publication_status") in CURRENT_DIGIT_STATUSES
        and article.get("local_audit_status") == "pass"
        and article.get("llm_review_status") == "pass"
    }


def _summary_image_quality_passed(reports_root: Path, market_date: str) -> bool:
    path = reports_root / "summary" / "quality" / f"{market_date}.json"
    if not path.is_file():
        return False
    payload = _load_json(path)
    return (
        payload.get("status") == "pass"
        and payload.get("publishable") is True
        and payload.get("article_variant") == "image_quote"
        and payload.get("schema_version") == "summary-image-article.v1"
    )


def component_editorial_issues(article: dict[str, Any]) -> list[str]:
    content = str(article.get("content") or "")
    headings = [
        re.sub(r"<[^>]+>", "", heading).strip()
        for heading in re.findall(
            r"(?is)<h[1-6]\b[^>]*>(.*?)</h[1-6]>",
            content,
        )
    ]
    translation_sections = {
        heading
        for heading in headings
        if heading in {"原文摘选", "忠实摘译", "原文逐句", "原文摘译", "原文延读"}
    }
    issues: list[str] = []
    if len(translation_sections) > 1:
        issues.append("duplicate_translation_sections")
    if article.get("stream") == "summary":
        if not clean_text(article.get("article_image_url")):
            issues.append("summary_image_url_missing")
        if "<img" not in content.casefold():
            issues.append("summary_image_missing_from_body")
    return issues


def discover_bundle_articles(
    reports_root: Path,
    market_date: str,
    *,
    max_articles: int = MAX_BUNDLE_ARTICLES,
) -> list[dict[str, Any]]:
    publish_root = reports_root / "wechat_publish"
    digit_articles: list[dict[str, Any]] = []
    current_slugs = _current_digit_slugs(reports_root, market_date)
    for payload_path in sorted((publish_root / "digit").glob(f"{market_date}_*_draft_payload.json")):
        prefix = f"{market_date}_"
        suffix = "_draft_payload.json"
        article_slug = payload_path.name[len(prefix):-len(suffix)]
        if article_slug not in current_slugs:
            continue
        state_path = payload_path.with_name(payload_path.name.replace("_payload.json", ".json"))
        component = _component_from_payload(
            payload_path,
            state_path,
            stream="digit",
            market_date=market_date,
        )
        if component and not component_editorial_issues(component):
            digit_articles.append(component)
    summary_payload = publish_root / "summary" / f"{market_date}_draft_payload.json"
    summary_state = publish_root / "summary" / f"{market_date}_draft.json"
    summary_article = None
    if _summary_image_quality_passed(reports_root, market_date):
        summary_article = _component_from_payload(
            summary_payload,
            summary_state,
            stream="summary",
            market_date=market_date,
        )
        if summary_article and component_editorial_issues(summary_article):
            summary_article = None
    articles = digit_articles[:max_articles]
    if summary_article and len(articles) < max_articles:
        articles.append(summary_article)
    return articles


def bundle_fingerprint(articles: list[dict[str, Any]]) -> str:
    canonical = [
        {
            key: article.get(key)
            for key in (
                "stream", "market_date", "title", "digest", "content",
                "thumb_media_id", "component_media_id",
            )
        }
        for article in articles
    ]
    return hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create one WeChat multi-article daily edition")
    parser.add_argument("--date", required=True)
    parser.add_argument("--action", choices=("draft", "publish"), default="draft")
    parser.add_argument("--reports-root", default=str(REPORTS_DIR))
    parser.add_argument("--config", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    reports_root = Path(args.reports_root)
    articles = discover_bundle_articles(reports_root, args.date)
    bundle_dir = reports_root / "wechat_publish" / "bundles"
    bundle_dir.mkdir(parents=True, exist_ok=True)
    state_path = bundle_dir / f"{args.date}_{args.action}.json"
    if not articles:
        print(json.dumps({
            "ok": True,
            "date": args.date,
            "status": "no_components",
            "article_count": 0,
        }, ensure_ascii=False, indent=2))
        return

    fingerprint = bundle_fingerprint(articles)
    if state_path.is_file() and not args.force:
        existing = _load_json(state_path)
        if existing.get("ok") is True and existing.get("fingerprint") == fingerprint:
            print(json.dumps({
                **existing,
                "skipped": True,
                "reason": "existing bundle matches current components",
            }, ensure_ascii=False, indent=2))
            return

    component_summary = [
        {
            "stream": article["stream"],
            "title": article["title"],
            "component_media_id": article["component_media_id"],
        }
        for article in articles
    ]
    if args.dry_run:
        print(json.dumps({
            "ok": True,
            "date": args.date,
            "status": "dry_run",
            "fingerprint": fingerprint,
            "article_count": len(articles),
            "components": component_summary,
        }, ensure_ascii=False, indent=2))
        return

    config_path = Path(args.config) if args.config else DEFAULT_CONFIG_PATH
    config = read_publish_config(config_path)
    access_token = get_access_token(config)
    if len(articles) == 1 and args.action == "draft":
        media_id = clean_text(articles[0].get("component_media_id"))
        verification = {
            "verified": True,
            "article_count": 1,
            "reused_component_draft": True,
        }
    else:
        response = create_multi_article_draft(access_token, articles)
        media_id = clean_text(response.get("media_id"))
        verification = verify_created_multi_article_draft(
            access_token,
            media_id,
            articles,
        )

    result: dict[str, Any] = {
        "ok": True,
        "date": args.date,
        "action": args.action,
        "fingerprint": fingerprint,
        "media_id": media_id,
        "article_count": len(articles),
        "components": component_summary,
        "verification": verification,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if args.action == "publish":
        publish_response = submit_publish(access_token, media_id)
        publish_id = clean_text(publish_response.get("publish_id"))
        publish_status = wait_publish_result(config, access_token, publish_id)
        if int(publish_status.get("publish_status", -1)) != 0:
            raise RuntimeError(f"WeChat bundle publish failed: {publish_status}")
        result.update({
            "publish_id": publish_id,
            "publish_status_response": publish_status,
        })
    state_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    emit_event(NotificationEvent(
        market_date=args.date,
        stream="bundle",
        severity="success",
        status_code="WECHAT_DAILY_BUNDLE_READY",
        title="ETI 每日多图文草稿已就绪",
        impact=f"已将 {len(articles)} 篇合格内容编为一次发送",
        action_required=False,
        recommended_action="在公众号后台预览该多图文草稿；无需处理缺席的内容流。",
        next_action="保持 review 模式，不自动群发。",
        details=[
            f"草稿ID：{media_id}",
            "组成：" + "、".join(article["stream"] for article in articles),
            f"文章数：{len(articles)}",
        ],
    ))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

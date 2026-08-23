"""Dify-backed faithful translations rendered deterministically into reader articles."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from .numeric_equivalence import numeric_values


NUMBER_PATTERN = re.compile(r"[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?")
UNIT_PATTERN = re.compile(r"(?i)\b(?:b/d|bbl/d|kb/d|mb/d|mt|kt|twh|mwh|gwh|mw|gw)\b")
THINK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
SEMANTIC_MARKERS = {
    "yeah, right": ("得了吧", "才怪", "讽刺", "怀疑"),
    "unlikely": ("不太可能", "不大可能", "可能性很低"),
    "temporary": ("临时", "暂时"),
    "temporarily": ("临时", "暂时"),
    "new": ("新", "新增", "新建"),
    "may": ("可能", "或许", "也许"),
    "might": ("可能", "或许", "也许"),
    "not": ("不", "未", "没有", "并非"),
    "no ": ("无", "不", "没有"),
}


def _numbers(text: str) -> set[str]:
    return numeric_values(text)


def _decode_output(outputs: Any, collection: str) -> dict[str, Any]:
    candidates = [outputs] if isinstance(outputs, dict) else []
    if isinstance(outputs, dict):
        candidates.extend(outputs.values())
    for candidate in candidates:
        if isinstance(candidate, dict) and collection in candidate:
            return candidate
        if not isinstance(candidate, str):
            continue
        try:
            cleaned = THINK_PATTERN.sub("", candidate).strip().strip("`").removeprefix("json").strip()
            decoded = json.loads(cleaned)
        except json.JSONDecodeError:
            continue
        if isinstance(decoded, dict) and collection in decoded:
            return decoded
    return {}


def _run_workflow(
    base_url: str, api_key: str, *, template_id: str, task: str,
    schema: dict[str, Any], items: list[dict[str, Any]], user: str,
) -> dict[str, Any]:
    response = httpx.post(
        f"{base_url.rstrip('/')}/v1/workflows/run",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"inputs": {
            "mode": "extract", "filename": f"{template_id}.json", "date": "",
            "raw_text": json.dumps(items, ensure_ascii=False),
            "template_id": template_id, "template_task": task,
            "template_schema": json.dumps(schema, ensure_ascii=False),
        }, "response_mode": "blocking", "user": user},
        timeout=300,
    )
    response.raise_for_status()
    return response.json().get("data", {}).get("outputs", {})


def _workflow_translations(
    base_url: str, api_key: str, *, template_id: str, task: str, items: list[dict[str, Any]],
) -> dict[str, str]:
    items = [item for item in items if str(item.get("text") or item.get("original") or "").strip()]
    if not items:
        return {}
    schema = {"translations": [{"id": "input id", "translation": "faithful Chinese translation"}]}
    outputs = _run_workflow(
        base_url, api_key, template_id=template_id, task=task, schema=schema,
        items=items, user="market-faithful-translation",
    )
    parsed = _decode_output(outputs, "translations")
    return {
        str(row.get("id")): str(row.get("translation", "")).strip()
        for row in parsed.get("translations", [])
        if isinstance(row, dict) and str(row.get("translation", "")).strip()
    }


def _translation_issues(original: str, translation: str) -> list[str]:
    missing = sorted(_numbers(original) - _numbers(translation))
    issues = [f"missing numeric tokens: {missing}"] if missing else []
    missing_units = sorted({unit.casefold() for unit in UNIT_PATTERN.findall(original)} - {
        unit.casefold() for unit in UNIT_PATTERN.findall(translation)
    })
    if missing_units:
        issues.append(f"missing original unit tokens: {missing_units}")
    original_folded = original.casefold()
    for marker, equivalents in SEMANTIC_MARKERS.items():
        marker_present = (
            bool(re.search(rf"\b{re.escape(marker)}\b", original_folded))
            if re.fullmatch(r"[a-z]+", marker)
            else marker in original_folded
        )
        if marker_present and not any(value in translation for value in equivalents):
            issues.append(f"missing semantic marker: {marker.strip()}")
    return issues


def _apply_domain_terminology(original: str, translation: str) -> str:
    if "disruption is inevitable" in original.casefold():
        translation = re.sub(r"颠覆(?=是不可避免)", "中断", translation)
    return translation


def _workflow_reviews(
    base_url: str, api_key: str, items: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if not items:
        return {}
    schema = {"reviews": [{
        "id": "input id", "decision": "pass|reject", "issues": ["issue"],
        "corrected_translation": "corrected Chinese translation or empty",
        "preserved_terms": ["term"],
    }]}
    outputs = _run_workflow(
        base_url, api_key, template_id="faithful_translation_review.v2",
        task=(
            "独立审校每条译文。逐项核对主体、动作、对象、日期、数字、单位、否定、范围限定、条件和不确定语气；"
            "特别检查讽刺、may、unlikely、new、temporary 等改变含义的词。"
            "其中 yeah, right 是讽刺和怀疑，绝不能译成肯定的‘是啊，没错’，应译为‘才怪’或‘得了吧’。"
            "准确则保持译文不变；不准确则修正。优先返回 reviews schema；若工作流只允许 translations schema，"
            "则返回每条审校后的最终译文。"
        ),
        schema=schema, items=items, user="market-faithful-translation-review",
    )
    parsed = _decode_output(outputs, "reviews")
    reviews = {
        str(row.get("id")): row for row in parsed.get("reviews", [])
        if isinstance(row, dict) and row.get("id") is not None
    }
    if reviews:
        return reviews
    translated = _decode_output(outputs, "translations")
    originals = {str(item.get("id")): item for item in items}
    return {
        str(row.get("id")): {
            "id": str(row.get("id")),
            "decision": "reject" if str(row.get("translation", "")).strip() != str(
                originals.get(str(row.get("id")), {}).get("translation", "")
            ).strip() else "pass",
            "issues": list(originals.get(str(row.get("id")), {}).get("local_issues", []) or []),
            "corrected_translation": str(row.get("translation", "")).strip(),
            "preserved_terms": [],
        }
        for row in translated.get("translations", []) if isinstance(row, dict) and row.get("id") is not None
    }


def translate_excerpts(
    base_url: str, api_key: str, excerpts: list[dict[str, str]],
) -> list[dict[str, Any]]:
    """Translate every excerpt, independently review it, then enforce local checks."""
    source_items = [
        {"id": str(index), "text": str(excerpt.get("original_excerpt", "")).strip()}
        for index, excerpt in enumerate(excerpts)
    ]
    literal_translations = _workflow_translations(
        base_url, api_key, template_id="faithful_translation.literal.v1", items=source_items,
        task=(
            "逐条生成忠实中文底稿。保留数字、单位、主体、对象、地点、日期、因果、条件、限定词、"
            "否定和不确定语气；不得概括、评论、补充、修辞改写或省略。只返回 translations JSON。"
        ),
    )
    publication_items = []
    for index, excerpt in enumerate(excerpts):
        original = str(excerpt.get("original_excerpt", "")).strip()
        literal = literal_translations.get(str(index), "")
        if original and literal:
            publication_items.append({
                "id": str(index), "original": original, "literal_translation": literal,
                "previous_context": str(excerpt.get("previous_context", "")),
                "next_context": str(excerpt.get("next_context", "")),
                "preserved_devices": list(excerpt.get("preserved_devices", []) or []),
            })
    publication_translations = _workflow_translations(
        base_url, api_key, template_id="faithful_translation.publication.v1",
        items=publication_items,
        task=(
            "在不改变忠实底稿事实含义的前提下生成出版级中文。消除英文语序，保留原文的比喻、反问、"
            "对比、讽刺和作者语气；严格保持主体、数字、单位、日期、因果、否定、条件和不确定程度。"
            "不得概括、评论、续写或添加背景。只返回 translations JSON。"
        ),
    )
    review_items = []
    for index, excerpt in enumerate(excerpts):
        original = str(excerpt.get("original_excerpt", "")).strip()
        translation = publication_translations.get(str(index), "")
        if original and translation:
            review_items.append({
                "id": str(index), "original": original, "translation": translation,
                "local_issues": _translation_issues(original, translation),
            })
    reviews = _workflow_reviews(base_url, api_key, review_items)
    result: list[dict[str, Any]] = []
    for index, excerpt in enumerate(excerpts):
        original = str(excerpt.get("original_excerpt", "")).strip()
        literal = literal_translations.get(str(index), "")
        initial = publication_translations.get(str(index), "")
        review = reviews.get(str(index), {})
        decision = str(review.get("decision", "needs_review")).casefold()
        corrected = str(review.get("corrected_translation", "") or "").strip()
        final_translation = corrected if decision == "reject" and corrected else initial
        final_translation = _apply_domain_terminology(original, final_translation)
        local_issues = _translation_issues(original, final_translation)
        status = "pass"
        if decision == "reject" and not corrected:
            status = "reject"
        elif not original or not final_translation or local_issues:
            status = "reject"
        elif decision not in {"pass", "reject"}:
            status = "needs_review"
        result.append({
            "excerpt_id": str(excerpt.get("excerpt_id", index)),
            "paragraph_role": str(excerpt.get("paragraph_role", "claim")),
            "source_title": str(excerpt.get("source_title", "Market publication")).strip(),
            "source_fact_ids": list(excerpt.get("source_fact_ids", []) or []),
            "original_excerpt": original,
            "literal_translation": literal,
            "publication_translation": final_translation,
            "initial_translation": initial,
            "review_decision": decision,
            "review_issues": list(dict.fromkeys([
                *list(review.get("issues", []) or []), *local_issues,
            ])),
            "corrected_translation": corrected or None,
            "preserved_terms": list(review.get("preserved_terms", []) or []),
            "translated_excerpt": final_translation,
            "translation_review_status": status,
        })
    return result


def _legacy_append_faithful_translations(markdown: str, translations: list[dict[str, Any]]) -> str:
    markdown = re.sub(
        r"(?ms)^(?:#{2,6}\s+(?:原文延读|忠实摘译|原文摘译)|"
        r"\*\*(?:原文延读|忠实摘译|原文摘译)\*\*)\s*$.*?"
        r"(?=^#{2,6}\s+|^\*\*[^*\n]+\*\*\s*$|\Z)",
        "", markdown,
    ).strip()
    if not translations:
        return markdown + "\n"
    cards = ["## 忠实摘译"]
    for item in translations:
        cards.extend([
            f"- **{item['source_title']}**：“{item['original_excerpt']}”",
            f"  译文：{item['translated_excerpt']}",
        ])
    block = "\n".join(cards)
    for heading in ("## 参考资料", "## 资料"):
        if heading in markdown:
            return markdown.replace(heading, f"{block}\n\n{heading}", 1)
    return markdown.rstrip() + "\n\n" + block + "\n"


def append_faithful_translations(
    markdown: str,
    translations: list[dict[str, Any]],
) -> str:
    """Render one authoritative translation section without repeated model text."""
    translation_heading = r"(?:原文摘选|忠实摘译|原文逐句|原文摘译|原文延读)"
    cleaned = re.sub(
        rf"(?ms)^(?:#{{2,6}}\s+{translation_heading}|"
        rf"\*\*{translation_heading}\*\*)\s*$.*?"
        rf"(?=^#{{2,6}}\s+|^\*\*[^*\n]+\*\*\s*$|\Z)",
        "",
        markdown,
    ).strip()
    if not translations:
        return cleaned + "\n"
    normalized_translations = {
        re.sub(r"\s+", " ", str(item.get("translated_excerpt") or "")).strip()
        for item in translations
        if str(item.get("translated_excerpt") or "").strip()
    }
    cleaned_lines = cleaned.splitlines()
    duplicate_indexes = {
        index for index, line in enumerate(cleaned_lines)
        if line.strip().startswith("> ")
        and re.sub(r"\s+", " ", line.strip()[2:]).strip() in normalized_translations
    }
    for index, line in enumerate(cleaned_lines):
        if not re.fullmatch(r"\*\*《.+?》写道：\*\*", line.strip()):
            continue
        next_content = next((
            candidate for candidate in range(index + 1, len(cleaned_lines))
            if cleaned_lines[candidate].strip()
        ), None)
        if next_content in duplicate_indexes:
            duplicate_indexes.add(index)
    cleaned = "\n".join(
        line for index, line in enumerate(cleaned_lines)
        if index not in duplicate_indexes
    )
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    lines = ["## 原文摘选"]
    current_source = ""
    for item in translations:
        source_title = str(item.get("source_title") or "Market publication").strip()
        if source_title != current_source:
            lines.append(f"**《{source_title}》写道：**")
            current_source = source_title
        translated = str(item.get("translated_excerpt") or "").strip()
        lines.extend([f"> {line}" for line in translated.splitlines() if line.strip()])
        lines.append("")
    block = "\n".join(lines)
    for heading in ("## 参考资料", "## 资料"):
        if heading in cleaned:
            return cleaned.replace(heading, f"{block}\n\n{heading}", 1)
    return cleaned.rstrip() + "\n\n" + block + "\n"

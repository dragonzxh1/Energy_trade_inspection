from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from intelligence.content_streams import (
    ArticleLocator,
    ArticlePaths,
    atomic_write_json,
    atomic_write_text,
    build_artifact_identity,
    resolve_article_paths,
)
from intelligence.daily_prices import (
    FusedDailyPrice,
    PUBLIC_LOCATION_NAMES,
    PUBLIC_PRODUCT_NAMES,
    PUBLIC_REGION_NAMES,
)


SEARCH_INTRO = "每日普氏价格参考，覆盖原油、汽油、柴油、航煤、燃料油等区域市场报价及涨跌。"


@dataclass(frozen=True)
class SummaryPriceArticle:
    locator: ArticleLocator
    title: str
    markdown: str
    wechat_html: str


def build_summary_image_article(target_date: date) -> SummaryPriceArticle:
    locator = ArticleLocator("summary", target_date)
    title = f"每日普氏价格｜{target_date.isoformat()} 图片报价"
    markdown = (f"# {title}\n\n" f"市场日期：{target_date.isoformat()}\n\n" "以下报价图片按原市场日期归档展示。结构化价格、历史比较与查询功能，将在同日机器人数据完成核对后开放。\n")
    wechat_html = ('<article data-eti-stream="summary-image" style="font-size:16px;line-height:1.7;color:#111827">' f"<h1>{html.escape(title)}</h1>" f"<p>市场日期：{target_date.isoformat()}</p>" "<p>以下为当日普氏报价图片。结构化价格与历史比较将在同日数据核对后开放。</p></article>")
    return SummaryPriceArticle(locator=locator, title=title, markdown=markdown, wechat_html=wechat_html)


def write_summary_image_article(article: SummaryPriceArticle, reports_root: Path, *, reference_image: Path, structured_price_verified: bool) -> ArticlePaths:
    paths = resolve_article_paths(article.locator, reports_root)
    summary_text = "每日普氏价格图片报价"
    issues: list[str] = []
    if not reference_image.is_file() or reference_image.stat().st_size == 0:
        issues.append("public reference image missing")
    if article.locator.market_date.isoformat() not in article.title:
        issues.append("market date missing from title")
    atomic_write_text(paths.markdown, article.markdown)
    atomic_write_text(paths.wechat_html, article.wechat_html)
    atomic_write_text(paths.summary, summary_text)
    atomic_write_json(paths.quality_audit, {"schema_version": "summary-image-article.v1", "stream": "summary", "article_variant": "image_quote", "market_date": article.locator.market_date.isoformat(), "status": "pass" if not issues else "fail", "publishable": not issues, "structured_price_verified": structured_price_verified, "issues": issues, **build_artifact_identity(article.locator, article.markdown, article.wechat_html, summary_text)})
    return paths

def build_summary_price_article(target_date: date, prices: list[FusedDailyPrice]) -> SummaryPriceArticle:
    public_prices = [price for price in prices if price.price is not None and price.change is not None]
    locator = ArticleLocator("summary", target_date)
    title = f"每日普氏价格表｜原油、成品油与区域价差｜{target_date.isoformat()}"
    search_intro = SEARCH_INTRO
    markdown_lines = [
        f"# {title}",
        "",
        f"> {search_intro}",
        "",
        f"市场日期：{target_date.year}年{target_date.month}月{target_date.day}日",
        "",
        f"单位：{_unit_note(public_prices)}",
    ]
    html_sections = [
        '<article data-eti-stream="summary" style="font-size:16px;line-height:1.7;color:#111827">',
        f'<h1>{html.escape(title)}</h1>',
        f'<p>{html.escape(search_intro)}</p>',
        f'<p>市场日期：{target_date.year}年{target_date.month}月{target_date.day}日</p>',
        f'<p>单位：{html.escape(_unit_note(public_prices))}</p>',
    ]
    for region, region_prices in _prices_by_region(public_prices):
        region_name = _display_region(region)
        markdown_lines.extend([
            "",
            f"## {region_name}",
            "",
            "| 产品 | 地区 | 价格 | 涨跌 |",
            "| --- | --- | ---: | ---: |",
        ])
        html_sections.extend([
            f"<h2>{html.escape(region_name)}</h2>",
            '<table style="width:100%;border-collapse:collapse">',
            "<thead><tr><th>产品</th><th>地区</th><th>价格</th><th>涨跌</th></tr></thead>",
            "<tbody>",
        ])
        for price in region_prices:
            product = _display_product(price)
            markdown_lines.append(
                f"| {_escape_markdown_cell(product)} | {_escape_markdown_cell(region_name)} | "
                f"{_format_price(price.price)} | {_format_change(price.change)} |"
            )
            direction, color = _change_style(price.change)
            html_sections.append(
                "<tr>"
                f"<td>{html.escape(product)}</td>"
                f"<td>{html.escape(region_name)}</td>"
                f"<td>{html.escape(_format_price(price.price))}</td>"
                f'<td data-change="{direction}" style="color:{color};font-weight:600">'
                f"{html.escape(_format_change(price.change))}</td>"
                "</tr>"
            )
        html_sections.extend(["</tbody>", "</table>"])
    html_sections.append("</article>")
    return SummaryPriceArticle(
        locator=locator,
        title=title,
        markdown="\n".join(markdown_lines) + "\n",
        wechat_html="".join(html_sections),
    )


def write_summary_price_article(
    article: SummaryPriceArticle,
    reports_root: Path,
    *,
    benchmark_quality: dict,
    release_status: str,
) -> ArticlePaths:
    paths = resolve_article_paths(article.locator, reports_root)
    summary_text = ""
    atomic_write_text(paths.markdown, article.markdown)
    atomic_write_text(paths.wechat_html, article.wechat_html)
    atomic_write_text(paths.summary, summary_text)
    issues = audit_summary_price_article(article)
    issues.extend(_benchmark_quality_issues(benchmark_quality, release_status))
    atomic_write_json(paths.quality_audit, {
        "schema_version": "summary-price-article.v1",
        "stream": "summary",
        "market_date": article.locator.market_date.isoformat(),
        "status": "pass" if not issues else "fail",
        "publishable": not issues,
        "release_status": release_status,
        "issues": issues,
        **benchmark_quality,
        **build_artifact_identity(
            article.locator, article.markdown, article.wechat_html, summary_text,
        ),
    })
    return paths


def _benchmark_quality_issues(benchmark_quality: dict, release_status: str) -> list[str]:
    issues: list[str] = []
    expected = benchmark_quality.get("expected", {})
    selected = benchmark_quality.get("selected", {})
    expected_keys = expected.get("keys") if isinstance(expected, dict) else None
    selected_keys = selected.get("keys") if isinstance(selected, dict) else None
    if release_status != "ready_with_prices":
        issues.append(f"summary release status is {release_status or 'missing'}")
    if not isinstance(expected_keys, list) or expected.get("count") != 18 or len(expected_keys) != 18:
        issues.append("public benchmark expected set is not exactly 18 keys")
    if not isinstance(selected_keys, list) or selected.get("count") != 18 or selected_keys != expected_keys:
        issues.append("public benchmark selected set does not exactly match expected keys")
    for status in ("missing", "conflict", "unavailable"):
        details = benchmark_quality.get(status, {})
        if not isinstance(details, dict) or details.get("count") != 0 or details.get("keys") != []:
            issues.append(f"public benchmark {status} entries present")
    return issues


def audit_summary_price_article(article: SummaryPriceArticle) -> list[str]:
    issues: list[str] = []
    forbidden = ("摘要", "分析", "判断", "建议", "传导", "来源", "AI")
    for value in forbidden:
        if value in article.markdown:
            issues.append(f"forbidden content: {value}")
    allowed_line = (
        "# ", "## ", "市场日期：", "单位：", "| 产品 | 地区 | 价格 | 涨跌 |", "| --- |", "| "
    )
    for line in article.markdown.splitlines():
        if line == f"> {SEARCH_INTRO}":
            continue
        if line and not line.startswith(allowed_line):
            issues.append(f"unexpected body line: {line}")
    if "<script" in article.wechat_html.lower():
        issues.append("unsafe HTML script tag")
    return issues


def _prices_by_region(prices: list[FusedDailyPrice]) -> list[tuple[str, list[FusedDailyPrice]]]:
    grouped: dict[str, list[FusedDailyPrice]] = {}
    for price in prices:
        grouped.setdefault(price.region, []).append(price)
    return [
        (region, sorted(region_prices, key=lambda price: (price.canonical_product, price.location)))
        for region, region_prices in sorted(grouped.items())
    ]


def _display_region(region: str) -> str:
    return PUBLIC_REGION_NAMES.get(region, region)


def _display_product(price: FusedDailyPrice) -> str:
    product = PUBLIC_PRODUCT_NAMES.get(price.canonical_product, price.canonical_product)
    location = PUBLIC_LOCATION_NAMES.get(price.location, price.location)
    return f"{product}（{location}）" if location else product


def _unit_note(prices: list[FusedDailyPrice]) -> str:
    labels = sorted({_unit_label(price.currency, price.unit) for price in prices})
    return "；".join(labels) if labels else "美元/吨"


def _unit_label(currency: str, unit: str) -> str:
    labels = {
        ("USD", "USD/MT"): "美元/吨",
        ("USD", "USD/BBL"): "美元/桶",
    }
    return labels.get((currency, unit), f"{currency}/{unit}")


def _escape_markdown_cell(value: str) -> str:
    return value.replace("|", "\\|")


def _format_price(value: Decimal | None) -> str:
    return f"{value:,.2f}" if value is not None else "-"


def _format_change(value: Decimal | None) -> str:
    if value is None:
        return "-"
    return f"{value:+,.2f}" if value else "0.00"


def _change_style(value: Decimal | None) -> tuple[str, str]:
    if value is not None and value > 0:
        return "up", "#047857"
    if value is not None and value < 0:
        return "down", "#b91c1c"
    return "flat", "#6b7280"

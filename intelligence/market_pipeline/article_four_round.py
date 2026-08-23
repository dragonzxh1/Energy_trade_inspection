"""Four-round article generation via sequential Dify LLM calls.

Round 1: Event extraction & clustering from raw materials
Round 2: Editorial filtering, quote selection & outline planning
Round 3: Article generation following editorial plan
Round 4: Fact-check, dedup & final polish
"""

from __future__ import annotations

import json
import re
from datetime import date
from typing import Any

import httpx

THINK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)

# ── Round 1: Event Extraction ──────────────────────────────────────────────
ROUND1_SYSTEM_PROMPT = """你是一名专业的能源行业编辑。请阅读以下全部原始材料，完成事件识别、信息提取和同类事件合并。

注意：此轮不要写公众号正文，不要写导语，不要进行文学化表达。

处理要求：
1. 提取每篇材料中的：事件日期、事件主体、事件动作、涉及地区、涉及能源品种、关键数据、事实信息、机构或作者判断、风险与不确定性、来源信息
2. 判断不同材料是否属于同一事件（报道同一件事的合并）
3. 同一事件多个来源时：合并重复事实，保留信息最完整的版本，标明各来源新增信息和冲突
4. 不要因为都涉及同一种能源就将不同事件合并
5. 不要把价格变化、政策发布、项目建设和企业动态强行归为同一事件
6. 对无法确定的信息标记为"待核实"，不要自行推断

输出格式：返回 JSON，格式为 {"events": [{"id": "E01", "title": "...", "date": "...", "category": "...", "entities": [], "regions": [], "core_facts": "...", "key_data": [], "source_views": [], "source_conflicts": [], "impacts": [], "watch_indicators": [], "sources": [], "has_duplicates": false, "unverified_items": []}], "duplicate_check": {"merged_reports": [], "data_conflicts": [], "time_conflicts": [], "unverifiable": []}}

只返回 JSON，不要加 markdown 标记或额外解释。"""

ROUND1_TASK = """请对以下能源行业原始材料执行第一轮：事件抽取与聚类。

{raw_text}

请严格按照系统提示词的要求，识别所有事件、合并同类事件、标记冲突和待核实信息。返回 JSON。"""


# ── Round 2: Editorial Filtering & Quote Selection ─────────────────────────
ROUND2_SYSTEM_PROMPT = """你是一名专业能源行业编辑。请根据第一轮抽取的事件清单和原始材料，制定当天公众号文章的编辑方案。

此轮仍然不要生成完整正文。

一、事件分级：
A级（今日重点1-3件）：对价格/供需/政策/产业有明显影响、涉及重大项目或企业、有独家数据或机构判断、可能影响后续走势
B级（重要动态3-8件）：有行业价值但不需要长篇分析
C级（一般快讯）：信息真实但影响范围小，压缩为一两句话

二、原文引用筛选（仅A级事件）：
只有以下情况才引用完整段落：政策法规关键条款、权威机构核心判断、企业公告重要表述、原作者高度概括表达、不同机构分歧需保留原话

三、输出编辑方案，返回 JSON：
{"title_suggestions": ["标题1", "标题2", "标题3"], "summary_events": [{"event_id": "E01", "one_liner": "一句话概括"}], "grade_a_events": [{"event_id": "E01", "why_important": "...", "suggested_length": "200-300字", "use_original_quote": true, "core_question": "..."}], "category_sections": {"原油与成品油": [], "天然气与LNG": [], "煤炭": [], "电力": [], "新能源与储能": [], "政策与监管": [], "企业与项目": [], "国际能源动态": []}, "data_table": [{"metric": "...", "value": "...", "change": "...", "period": "...", "source": "..."}], "future_watch": [{"item": "...", "why": "..."}]}

只返回 JSON，不要加 markdown 标记或额外解释。"""

ROUND2_TASK = """以下是第一轮事件抽取的结果和原始材料。

=== 事件清单 ===
{events_json}

=== 原始材料 ===
{raw_text}

请严格按照系统提示词的要求，完成事件分级、原文引用筛选和编辑方案制定。返回 JSON。"""


# ── Round 3: Article Generation ────────────────────────────────────────────
ROUND3_SYSTEM_PROMPT = """你是一名专业的能源行业编辑，负责根据事件清单和编辑方案生成一篇可直接用于微信公众号排版的每日能源资讯文章。

这是一篇每日资讯整合文章，不要求所有事件具有统一观点。

文章结构：
# 标题（包含当天最重要1-3个事件，避免夸张用词）
## 今日能源要点（3-5条，每条40-80字，直接说明发生了什么）
## 今日重点（1-3件A级事件，每件包含：发生了什么、为什么重要、核心原文（如有）、编辑解读、后续关注）
## 分类动态（按栏目：原油与成品油、天然气与LNG等，B级100-200字，C级40-100字）
## 数据速览（适合表格化的数据，不用表格时列点）
## 后续关注（3-5项）
## 结尾（100-200字，说明最值得观察的变量和不确定性）

关键规则：
- 不得虚构原始材料中不存在的事实、数字、时间、主体、观点或引文
- 事实、机构预测、编辑判断必须明确区分
- 同一事件只能在全文出现一次
- 引文必须逐字保留，不得润色、改写、拼接，格式为：> **核心原文｜来源**
- 每段不超过120字，小标题直接说明事件
- 不使用"值得注意的是""众所周知""毫无疑问"等套话
- 全文建议2500-4000字，证据不足时宁可简短
- 不输出"根据提示词""作为AI"等表述

返回 JSON：{"title": "...", "summary": "...", "report_markdown": "..."}
只返回 JSON，不要加 markdown 标记或额外解释。"""

ROUND3_TASK = """以下是编辑方案和原始材料，请生成公众号文章。

=== 编辑方案 ===
{editorial_plan_json}

=== 原始材料 ===
{raw_text}

请严格按照系统提示词的要求生成文章。返回 JSON。"""


# ── Round 4: Fact-Check & Final Polish ─────────────────────────────────────
ROUND4_SYSTEM_PROMPT = """你现在是事实核查编辑和文字编辑。请对初稿进行最终审校，并输出可直接发布的版本。

检查项目：
1. 事实核查：人名、机构名、企业名、国家/地区、日期、金额、产量、价格、涨跌幅、容量、单位、政策名称、项目名称 —— 只允许使用原始材料中的信息
2. 引文核查：逐字核对引号内文字是否与原文一致，是否存在润色、拼接、省略改变原意，无法确认的引文必须删除
3. 去重检查：删除同一事件在摘要/重点/分类动态中的重复展开、同一结论反复表述、无新增信息的过渡段
4. 逻辑检查：相关性不能写成因果关系、机构预测不能写成事实、短期变化不能写成长期趋势
5. 语言检查：删除"值得注意的是""众所周知""在此背景下"等套话，减少过长句、空泛判断

先输出简短修改报告（删除的重复、修正的事实、删除的引文、需人工核实的），再输出最终文章。

返回 JSON：
{"modifications": {"deleted_duplicates": [], "corrected_facts": [], "deleted_quotes": [], "needs_human_review": []}, "title": "...", "summary": "...", "report_markdown": "..."}

只返回 JSON，不要加 markdown 标记或额外解释。"""

ROUND4_TASK = """请对以下文章初稿进行第四轮：去重、事实核对与最终定稿。

=== 文章初稿 ===
{draft_markdown}

=== 原始材料 ===
{raw_text}

请严格按照系统提示词的要求进行审核，先输出修改报告再输出最终文章。返回 JSON。"""


def _call_dify_llm(
    base_url: str, api_key: str, system_prompt: str, user_message: str,
    market_date: date, timeout: int = 300,
) -> dict[str, Any]:
    """Call Dify workflow to run a single LLM round."""
    output_schema = {
        "type": "object",
        "additionalProperties": True,
    }
    response = httpx.post(
        f"{base_url.rstrip('/')}/v1/workflows/run",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "inputs": {
                "mode": "structured_article",
                "filename": f"four-round-{market_date.isoformat()}.json",
                "date": market_date.isoformat(),
                "raw_text": user_message,
                "template_id": "four-round.v1",
                "template_task": system_prompt,
                "template_schema": json.dumps(output_schema, ensure_ascii=False),
            },
            "response_mode": "blocking",
            "user": "four-round-writer",
        },
        timeout=timeout,
    )
    response.raise_for_status()
    outputs = response.json().get("data", {}).get("outputs", {})
    
    # Try to extract JSON from outputs
    for value in outputs.values():
        if isinstance(value, dict) and len(value) > 1:
            return value
        if isinstance(value, str):
            cleaned = THINK_PATTERN.sub("", value).strip().strip("`")
            try:
                decoded = json.loads(cleaned.removeprefix("json").strip())
            except json.JSONDecodeError:
                continue
            if isinstance(decoded, dict):
                return decoded
    
    # Fallback: check if outputs themselves are the result
    if outputs.get("title") or outputs.get("events") or outputs.get("report_markdown"):
        return outputs
    
    # If all else fails, return raw outputs
    return {"_raw": outputs, "_error": "Failed to parse structured output"}


def generate_article_four_round(
    base_url: str,
    api_key: str,
    market_date: date,
    raw_text: str,
    timeout: int = 300,
) -> dict[str, Any]:
    """Generate an article using the 4-round methodology.
    
    Args:
        base_url: Dify API base URL
        api_key: Dify workflow API key
        market_date: The market date for the article
        raw_text: The raw editorial view payload (JSON string)
        timeout: Timeout per round in seconds
    
    Returns:
        dict with title, summary, report_markdown, and round_results
    """
    round_results = {}
    
    # ── Round 1: Event Extraction ──
    print(f"[4R] Round 1/4: Extracting events...")
    r1 = _call_dify_llm(
        base_url, api_key,
        system_prompt=ROUND1_SYSTEM_PROMPT,
        user_message=ROUND1_TASK.format(raw_text=raw_text),
        market_date=market_date, timeout=timeout,
    )
    round_results["round1"] = r1
    events_json = json.dumps(r1, ensure_ascii=False, indent=2)
    event_count = len(r1.get("events", []))
    print(f"[4R] Round 1 done: {event_count} events extracted")
    
    # ── Round 2: Editorial Filtering ──
    print(f"[4R] Round 2/4: Editorial filtering...")
    r2 = _call_dify_llm(
        base_url, api_key,
        system_prompt=ROUND2_SYSTEM_PROMPT,
        user_message=ROUND2_TASK.format(events_json=events_json, raw_text=raw_text),
        market_date=market_date, timeout=timeout,
    )
    round_results["round2"] = r2
    plan_json = json.dumps(r2, ensure_ascii=False, indent=2)
    grade_a = len(r2.get("grade_a_events", []))
    print(f"[4R] Round 2 done: {grade_a} grade-A events, {len(r2.get('title_suggestions', []))} title suggestions")
    
    # ── Round 3: Article Generation ──
    print(f"[4R] Round 3/4: Generating article...")
    r3 = _call_dify_llm(
        base_url, api_key,
        system_prompt=ROUND3_SYSTEM_PROMPT,
        user_message=ROUND3_TASK.format(editorial_plan_json=plan_json, raw_text=raw_text),
        market_date=market_date, timeout=timeout,
    )
    round_results["round3"] = r3
    draft_md = r3.get("report_markdown", "")
    title = r3.get("title", "")
    print(f"[4R] Round 3 done: {len(draft_md)} chars, title='{title[:60]}...'")
    
    # ── Round 4: Fact-Check & Final Polish ──
    print(f"[4R] Round 4/4: Fact-checking & finalizing...")
    r4 = _call_dify_llm(
        base_url, api_key,
        system_prompt=ROUND4_SYSTEM_PROMPT,
        user_message=ROUND4_TASK.format(draft_markdown=draft_md, raw_text=raw_text),
        market_date=market_date, timeout=timeout,
    )
    round_results["round4"] = r4
    
    final_md = r4.get("report_markdown", draft_md)
    final_title = r4.get("title", title)
    final_summary = r4.get("summary", r3.get("summary", ""))
    modifications = r4.get("modifications", {})
    
    print(f"[4R] Round 4 done: {len(final_md)} chars final, "
          f"modifications: {sum(len(v) for v in modifications.values())} items")
    
    return {
        "title": final_title,
        "summary": final_summary,
        "report_markdown": final_md,
        "round_results": round_results,
    }


def generate_article_simple(
    base_url: str,
    api_key: str,
    market_date: date,
    raw_text: str,
    timeout: int = 300,
) -> dict[str, Any]:
    """Simplified fallback: single-round generation when materials < 8 items."""
    task = """你是一名专业能源行业编辑。请将以下多篇能源新闻、报告和政策材料整理成一篇微信公众号"每日能源观察"。

这些材料涉及的事件不一定具有统一观点。不要强行提炼一个总论点，而要按照当天发生的独立事件进行整理。

请完成以下任务：
1. 识别每篇材料中的事件主体、时间、动作、数据和来源
2. 将报道同一事件的不同来源合并
3. 删除重复事实、重复背景和重复结论
4. 按重要性分为重点事件、重要动态和一般快讯
5. 选择1至3件重点事件详细写
6. 其他事件按原油、天然气、煤炭、电力、新能源、政策、企业与项目等类别整理
7. 不存在重要内容的栏目不要保留
8. 不得虚构材料中没有的事实、数字、观点和因果关系
9. 机构预测必须注明是预测，不得写成事实
10. 同一事件不得在文章中重复展开

对重点事件采用：发生了什么、为什么重要、核心原文、编辑解读、后续关注。
所有直接引文必须逐字保留、不得润色、不得拼接、不得凭记忆补充、注明来源和日期。

返回 JSON：{"title": "...", "summary": "...", "report_markdown": "..."}
只返回 JSON，不要加 markdown 标记或额外解释。"""

    return _call_dify_llm(
        base_url, api_key,
        system_prompt=task,
        user_message=f"请将以下原始材料整理成每日能源观察文章：\n\n{raw_text}",
        market_date=market_date, timeout=timeout,
    )

# ── Dify-Native 4-Round Wrapper ────────────────────────────────────────────

def call_dify_4round_writer(
    base_url: str,
    api_key: str,
    market_date,
    raw_text: str,
    timeout: int = 600,
):
    """Call the Dify-native 4-round workflow (single API call, 4 internal LLM nodes).
    
    Returns dict with title, summary, report_markdown.
    """
    import httpx
    
    response = httpx.post(
        f"{base_url.rstrip('/')}/v1/workflows/run",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "inputs": {
                "raw_text": raw_text,
                "date": market_date.isoformat() if hasattr(market_date, 'isoformat') else str(market_date),
                "filename": f"4round-{market_date}.json",
            },
            "response_mode": "blocking",
            "user": "four-round-writer",
        },
        timeout=timeout,
    )
    response.raise_for_status()
    outputs = response.json().get("data", {}).get("outputs", {})

    for value in outputs.values():
        if isinstance(value, str):
            cleaned = THINK_PATTERN.sub("", value).strip().strip("`")
            try:
                decoded = json.loads(cleaned.removeprefix("json").strip())
            except json.JSONDecodeError:
                continue
            if isinstance(decoded, dict) and "report_markdown" in decoded:
                return {
                    "title": decoded.get("title", ""),
                    "summary": decoded.get("summary", ""),
                    "report_markdown": decoded.get("report_markdown", ""),
                }

    title = str(outputs.get("title", ""))
    md = str(outputs.get("report_markdown", ""))
    if md:
        return {"title": title, "summary": "", "report_markdown": md}

    raise ValueError(
        "Dify 4-round output missing report_markdown: "
        + json.dumps(outputs, ensure_ascii=False, default=str)[:2400]
    )

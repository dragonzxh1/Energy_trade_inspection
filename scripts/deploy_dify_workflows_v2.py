from __future__ import annotations

import copy
import argparse
import json
import os
import uuid
from datetime import datetime, timezone

import psycopg2


EXTRACT_APP = "ETI Structured Extract"
WRITER_APP = "ETI Article Writer"
REVIEW_APP = "ETI Publication Review"


def code_node(node_id: str, title: str, code: str, variables: list[dict], outputs: dict, x: int) -> dict:
    return {
        "id": node_id,
        "type": "custom",
        "width": 242,
        "height": 72,
        "position": {"x": x, "y": 282},
        "sourcePosition": "right",
        "targetPosition": "left",
        "data": {
            "type": "code",
            "title": title,
            "code": code,
            "code_language": "python3",
            "selected": False,
            "variables": variables,
            "outputs": outputs,
        },
    }


def edge(source: str, target: str, source_type: str | None = None, target_type: str | None = None) -> dict:
    data = {}
    if source_type:
        data["sourceType"] = source_type
    if target_type:
        data["targetType"] = target_type
    return {
        "id": f"{source}-source-{target}-target",
        "type": "custom",
        "source": source,
        "target": target,
        "sourceHandle": "source",
        "targetHandle": "target",
        "data": data,
    }


def nodes_by_type(graph: dict) -> dict[str, dict]:
    return {node.get("data", {}).get("type"): node for node in graph.get("nodes", [])}


def decode_json_value(value):
    if isinstance(value, str):
        return json.loads(value)
    return value


def encode_json_value(value):
    return json.dumps(decode_json_value(value), ensure_ascii=False) if value is not None else None


EXTRACT_FILTER_CODE = r'''import json
import re

VALID_DIRECTIONS = {"up", "down", "flat", "mixed", "unknown"}

def normalize(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()

def cleaned_text(text):
    value = re.sub(r"<think>.*?</think>", "", text or "", flags=re.I | re.S).strip()
    return re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", value, flags=re.I).strip()

def decode_json(text):
    cleaned = cleaned_text(text)
    try:
        return json.loads(cleaned, strict=False)
    except Exception:
        left, right = cleaned.find("{"), cleaned.rfind("}")
        if left >= 0 and right > left:
            return json.loads(cleaned[left:right + 1], strict=False)
        raise

def rejection_code(fact, raw_text):
    if not isinstance(fact, dict):
        return "INVALID_FACT_OBJECT"
    evidence = normalize(fact.get("evidence_text"))
    if not evidence:
        return "MISSING_EVIDENCE"
    if evidence not in normalize(raw_text):
        return "EVIDENCE_NOT_EXACT"
    if fact.get("direction") not in VALID_DIRECTIONS:
        return "INVALID_DIRECTION"
    fact_type = fact.get("fact_type")
    value, unit = fact.get("value"), fact.get("unit")
    change_value, change_unit = fact.get("change_value"), fact.get("change_unit")
    if value is not None and not unit:
        return "MISSING_UNIT"
    if value is not None and str(unit).casefold() not in evidence.casefold():
        return "UNIT_NOT_VERBATIM"
    if change_value is not None and not change_unit:
        return "MISSING_CHANGE_UNIT"
    if change_value is not None and str(change_unit).casefold() not in evidence.casefold():
        return "CHANGE_UNIT_NOT_VERBATIM"
    if fact_type == "price" and (value is None or change_value is not None):
        return "INVALID_PRICE_ATOMICITY"
    if fact_type == "price_change" and (change_value is None or value is not None):
        return "INVALID_PRICE_CHANGE_ATOMICITY"
    return ""

def main(llm_text, raw_text, mode="", template_id=""):
    if mode != "source_fact" and template_id != "market-fact.v1":
        return {"result": cleaned_text(llm_text)}
    try:
        payload = decode_json(llm_text)
        decode_error = None
    except Exception as error:
        payload = {}
        decode_error = f"{type(error).__name__}: {error}"
    facts = payload.get("facts", []) if isinstance(payload, dict) else []
    if not isinstance(facts, list):
        facts = []
        decode_error = decode_error or "facts is not an array"
    accepted = []
    rejections = []
    for index, fact in enumerate(facts):
        reason = rejection_code(fact, raw_text)
        if reason:
            rejections.append({"index": index, "reason_code": reason})
        else:
            accepted.append(fact)
    result = {
        "schema_version": "market-fact.v1",
        "facts": accepted,
        "contract_filter": {
            "model_facts_count": len(facts),
            "accepted_facts_count": len(accepted),
            "rejected_facts_count": len(rejections),
            "rejections": rejections,
            "decode_error": decode_error,
        },
    }
    return {"result": json.dumps(result, ensure_ascii=False)}
'''


WRITER_CODE = r'''import json
import re

def decode(text):
    cleaned = re.sub(r"<think>.*?</think>", "", text or "", flags=re.I | re.S).strip()
    cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", cleaned, flags=re.I).strip()
    try:
        return json.loads(cleaned, strict=False)
    except Exception:
        left, right = cleaned.find("{"), cleaned.rfind("}")
        if left >= 0 and right > left:
            return json.loads(cleaned[left:right + 1], strict=False)
        raise

def main(llm_text):
    payload = decode(llm_text)
    title = str(payload.get("title") or "").strip()
    summary = str(payload.get("summary") or "").strip()
    report_markdown = str(payload.get("report_markdown") or "").strip()
    if not title or not summary or not report_markdown:
        raise ValueError("writer output is missing title, summary or report_markdown")
    return {"title": title, "summary": summary, "report_markdown": report_markdown}
'''


REVIEW_CODE = r'''import json
import re

def cleaned_text(text):
    cleaned = re.sub(r"<think>.*?</think>", "", text or "", flags=re.I | re.S).strip()
    return re.sub(r"^\s*```(?:json|markdown)?\s*|\s*```\s*$", "", cleaned, flags=re.I).strip()

def decode(text):
    cleaned = cleaned_text(text)
    try:
        return json.loads(cleaned, strict=False)
    except Exception:
        left, right = cleaned.find("{"), cleaned.rfind("}")
        if left >= 0 and right > left:
            return json.loads(cleaned[left:right + 1], strict=False)
        raise

def salvage_revised_markdown(text):
    cleaned = cleaned_text(text)
    if cleaned.startswith("#"):
        return cleaned
    match = re.search(r'"revised_markdown"\s*:\s*"', cleaned)
    if not match:
        return ""
    value = cleaned[match.end():].strip()
    value = re.sub(r'"\s*}\s*$', '', value, count=1).strip()
    return value.replace(r'\n', '\n').replace(r'\"', '"').replace(r'\\', '\\').strip()

def main(llm_text, mode):
    if mode == "revise":
        try:
            payload = decode(llm_text)
        except Exception:
            payload = {"revised_markdown": salvage_revised_markdown(llm_text)}
        revised = str(payload.get("revised_markdown") or "").strip()
        if not revised:
            raise ValueError("review revision is empty")
        return {
            "decision": "", "score": 0, "dimension_scores_json": "{}",
            "blocking_issues": [], "revision_instructions": [], "summary": "",
            "revised_markdown": revised,
        }
    payload = decode(llm_text)
    decision = str(payload.get("decision") or "").lower()
    score = float(payload.get("score") or 0)
    blockers = payload.get("blocking_issues") or []
    instructions = payload.get("revision_instructions") or []
    if decision not in {"pass", "reject"} or not 0 <= score <= 100:
        raise ValueError("invalid review decision or score")
    if not isinstance(blockers, list) or not isinstance(instructions, list):
        raise ValueError("invalid review issue arrays")
    def normalized_issue(item):
        if not isinstance(item, dict):
            return str(item)
        issue_type = str(item.get("type") or "blocking_issue")
        description = str(item.get("description") or item.get("detail") or "").strip()
        offending = str(item.get("offending_text") or item.get("sentence") or "").strip()
        parts = [issue_type]
        if description:
            parts.append(description)
        if offending:
            parts.append(f"原句：“{offending}”")
        return "；".join(parts)
    return {
        "decision": decision,
        "score": score,
        "dimension_scores_json": json.dumps(payload.get("dimension_scores") or {}, ensure_ascii=False),
        "blocking_issues": [normalized_issue(item) for item in blockers],
        "revision_instructions": [normalized_issue(item) for item in instructions],
        "summary": str(payload.get("summary") or ""),
        "revised_markdown": "",
    }
'''


WRITER_SYSTEM_PROMPT = """你是ETI中文能源出版编辑。只使用输入证据撰写文章，只输出合法JSON，不输出代码围栏、解释或思考过程。
严格执行article_contract与article_mode。不得补造事实、数字、主体、因果、价格预测或来源。每个事实段必须能在evidence_payload中找到依据。
faithful_translation保留原文论证和限定语气，不强制市场观点；event_brief只说明事件、已确认细节及可能影响，不强制方向判断；market_analysis才允许受约束的传导分析。
event_brief正文目标至少1100个中文字符，不得贴近900字最低验收线。
当 story_form=source_close_reading 且有至少4段主题相关原文时，目标为1500至2200个中文字符；篇幅必须来自原文论证、来源表述和已验证背景，不得通过通用市场影响或预测填充。
标题和摘要必须是自然、完整的中文编辑表达；行业缩写可保留，但不得使用“Oil · China”“Market｜Global”这类内部标签拼接作为标题。
标题和章节名称必须严格使用合同指定写法。输出固定为：{"title":"","summary":"","report_markdown":""}。"""


REVIEW_SYSTEM_PROMPT = """你是ETI能源出版终审编辑。只输出合法JSON，不输出代码围栏、解释或思考过程。

运行模式review：只审查，不改写。真正阻断项仅包括：日期错误、虚构或不可追溯事实、数字或单位错误、主体错误、实质性误译、来源错配、结论与证据冲突、跨主题事实混入、内部信息泄露、危险HTML和模板残留。
以下只能作为提示，不得降低分数或导致reject：缺少方向预测、反向信号、失效条件、三个验证指标、历史价格比较，或仅有一个已明确归因的权威来源。
按article_mode审查：faithful_translation重点检查原文论证、限定语气和翻译忠实度，不要求独立市场观点；event_brief重点检查主体、日期、动作、影响对象和归因，不要求方向判断；market_analysis额外检查事实到市场影响的传导链；legacy按事实型日报处理。
实际数字字符、符号和单位必须与证据一致；词汇型数量应忠实翻译，例如multibillion-dollar译为“数十亿美元”本身不是数字错误。
只有总分不低于85且阻断项为空时pass。blocking_issues必须是字符串数组，每项必须包含最终Markdown中的具体原句，不得返回对象数组。
review输出：{"decision":"pass|reject","score":0,"dimension_scores":{"factuality":0,"translation_fidelity":0,"analysis_or_source_fidelity":0,"readability":0,"publication_safety":0},"blocking_issues":[],"revision_instructions":[],"summary":""}

运行模式revise：只根据证据和previous_review修订一次，不新增事实，不强制补写方向预测、反向信号、失效条件或验证指标。输出：{"revised_markdown":"完整Markdown"}。"""


WRITER_SYSTEM_PROMPT_V3 = """你是能见社中文能源出版编辑。只使用输入中的 StoryBrief、ClaimLedger、已验证事实、外部确认和段落摘译写作，只输出合法 JSON，不输出代码围栏、解释或思考过程。

StoryBrief 是本篇唯一编辑任务：回答 reader_question，围绕 one_sentence_takeaway 展开，遵守 story_form、opening_strategy、ending_strategy、must_use_excerpt_ids 和 prohibited_claims。不得擅自改换主题。

文章不是日报模板。除“参考资料”外，不强制使用固定栏目；根据 story_form 自然组织：原文精读应保留原文论证顺序，问题导向稿围绕一个问题推进，时间线稿按事件变化组织，多来源稿呈现互补或冲突，数据解释稿从一个经验证数字展开，观点比较稿清楚区分各方判断。

必须明确区分原文事实、来源观点、忠实摘译、外部确认、背景解释和能见社编辑推演，但不要把这些内部角色名写进正文。能见社推演只能使用 allowed_inference_ids，不得把来源观点写成市场共识。

忠实摘译必须保持主体、日期、数字、单位、因果、否定、条件、限定词和不确定语气；数字可保留原文写法，或使用可被确定性等值核对的中文化写法，但不得近似换算或改变精度。优先保留原文特有的比喻、对比、反问、讽刺和论证节奏。不得把搜索摘要、聚合页、AI 摘要或未验证外部候选写入正文。

禁止通用填充句，特别是没有具体对象的“可能产生影响”“值得关注”“尚待观察”，以及与本篇无关的航运、保险、绕行和价格波动套话。不得泄露文件名、内部 ID、字段名、工作流、Prompt、模型或 AI 相关措辞。

长度服从证据：证据足够时形成有信息密度的完整文章；证据不足时宁可写成较短的原文精读，不得自由补写。输出固定为 {"title":"","summary":"","report_markdown":""}。"""


REVIEW_SYSTEM_PROMPT_V3 = """你是能见社能源出版终审编辑。只输出合法 JSON，不输出代码围栏、解释或思考过程。

review 模式只审查，不改写。不要按固定栏目验收，而要检查语义覆盖：是否回答 StoryBrief.reader_question；是否保留 source_thesis 与原文论证；是否正确使用 must_use_excerpt_ids；是否保留限定条件与不确定语气；是否区分来源观点、外部确认和编辑推演；是否存在无证据事实、通用填充段落或重复模板。

真正阻断项仅包括：日期错误、虚构或不可追溯事实、数字或单位错误、主体错误、实质性误译、来源错配、结论与证据冲突、使用 prohibited_claims、跨主题事实混入、内部信息泄露、危险 HTML 和模板残留。每个 blocking_issue 必须逐字引用最终 Markdown 中的具体原句。

以下仅作编辑提示，不得单独降低分数或导致 reject：缺少方向预测、反向信号、失效条件、三个验证指标、历史价格比较，或仅有一个已明确归因的权威来源。

风格审查应拒绝没有具体主体和对象的空泛套话，指出与最近文章重复的结构或段落，但只有影响事实表达、来源区分或形成实质性模板残留时才列为阻断项。忠实摘译重点检查原文论证、比喻、对比、否定、限定词和不确定语气，而不是要求独立市场观点。

总分不低于 85 且 blocking_issues 为空时 pass。review 输出 {"decision":"pass|reject","score":0,"dimension_scores":{"factuality":0,"translation_fidelity":0,"source_style_fidelity":0,"readability":0,"publication_safety":0},"blocking_issues":[],"revision_instructions":[],"summary":""}。

revise 模式只依据证据和 previous_review 修订一次，不新增事实，不补写被确定性清理删除的内容，不强制增加固定栏目。输出 {"revised_markdown":"完整 Markdown"}。"""


def patch_extract(graph: dict) -> dict:
    graph = copy.deepcopy(graph)
    typed = nodes_by_type(graph)
    start, llm, end, code = typed["start"], typed["llm"], typed["end"], typed["code"]
    llm["data"]["model"]["completion_params"] = {
        "max_tokens": 6000,
        "temperature": 0,
        "thinking": False,
        "response_format": "json_object",
    }
    prompt = llm["data"]["prompt_template"][0]["text"]
    prompt = prompt.replace(
        "当 template_id 为 faithful_translation_review 时",
        "当 template_id 为 faithful_translation_review.v2 时",
    ).replace(
        '只返回 {"translations":[{"id":"原 id","translation":"修正后的忠实中文直译"}]}。',
        '只返回 {"reviews":[{"id":"原 id","decision":"pass|reject","issues":[],"corrected_translation":"修正译文或空字符串","preserved_terms":[]}]}。',
    )
    llm["data"]["prompt_template"][0]["text"] = prompt
    code["data"]["code"] = EXTRACT_FILTER_CODE
    end["data"]["outputs"] = [{"variable": "result", "value_selector": [code["id"], "result"]}]
    graph["edges"] = [
        edge(start["id"], llm["id"], "start", "llm"),
        edge(llm["id"], code["id"]),
        edge(code["id"], end["id"]),
    ]
    return graph


def patch_writer(graph: dict) -> dict:
    graph = copy.deepcopy(graph)
    typed = nodes_by_type(graph)
    start, llm, end = typed["start"], typed["llm"], typed["end"]
    code_id = "eti-writer-contract-v2"
    start["data"]["title"] = "ETI Writer Input v2"
    start["data"]["variables"] = [
        {"type": "text-input", "label": "article_mode", "required": True, "variable": "article_mode", "max_length": 48},
        {"type": "text-input", "label": "date", "required": True, "variable": "date", "max_length": 48},
        {"type": "paragraph", "label": "evidence_payload", "required": True, "variable": "evidence_payload", "max_length": 100000},
        {"type": "paragraph", "label": "article_contract", "required": True, "variable": "article_contract", "max_length": 12000},
    ]
    llm["data"]["title"] = "ETI Article Writer v3"
    llm["data"]["model"]["completion_params"] = {
        "max_tokens": 12000,
        "temperature": 0.4,
        "thinking": False,
        "response_format": "json_object",
    }
    llm["data"]["prompt_template"] = [
        {"role": "system", "text": WRITER_SYSTEM_PROMPT_V3},
        {"role": "user", "text": "文章类型：{{#" + start["id"] + ".article_mode#}}\n市场日期：{{#" + start["id"] + ".date#}}\n文章合同：\n{{#" + start["id"] + ".article_contract#}}\n证据：\n{{#" + start["id"] + ".evidence_payload#}}"},
    ]
    code = code_node(
        code_id, "Deterministic Writer Contract", WRITER_CODE,
        [{"variable": "llm_text", "value_selector": [llm["id"], "text"]}],
        {name: {"type": "string", "children": None} for name in ("title", "summary", "report_markdown")},
        720,
    )
    end["data"]["outputs"] = [
        {"variable": name, "value_selector": [code_id, name]}
        for name in ("title", "summary", "report_markdown")
    ]
    graph["nodes"] = [start, llm, code, end]
    graph["edges"] = [
        edge(start["id"], llm["id"], "start", "llm"),
        edge(llm["id"], code_id),
        edge(code_id, end["id"]),
    ]
    return graph


def patch_review(graph: dict) -> dict:
    graph = copy.deepcopy(graph)
    typed = nodes_by_type(graph)
    start, llm, end = typed["start"], typed["llm"], typed["end"]
    code_id = "eti-review-contract-v2"
    variables = start["data"]["variables"]
    if not any(item.get("variable") == "article_mode" for item in variables):
        variables.insert(1, {
            "hint": "", "type": "text-input", "label": "article_mode文章类型",
            "default": "", "options": [], "required": True,
            "variable": "article_mode", "max_length": 48, "placeholder": "",
        })
    llm["data"]["title"] = "ETI Publication Review v3"
    flash_model = os.getenv("DIFY_FLASH_MODEL_NAME", "deepseek-v4-flash").strip()
    if flash_model:
        llm["data"]["model"]["name"] = flash_model
    llm["data"]["model"]["completion_params"] = {
        "temperature": 0,
        "max_tokens": 8192,
        "thinking": False,
        "response_format": "json_object",
    }
    llm["data"]["prompt_template"] = [
        {"role": "system", "text": REVIEW_SYSTEM_PROMPT_V3},
        {"role": "user", "text": "运行模式：{{#" + start["id"] + ".mode#}}\n文章类型：{{#" + start["id"] + ".article_mode#}}\n报告日期：{{#" + start["id"] + ".date#}}\n最终Markdown：\n{{#" + start["id"] + ".report_markdown#}}\n结构化证据：\n{{#" + start["id"] + ".extractions#}}\n上一轮审校：\n{{#" + start["id"] + ".previous_review#}}"},
    ]
    outputs = {
        "decision": {"type": "string", "children": None},
        "score": {"type": "number", "children": None},
        "dimension_scores_json": {"type": "string", "children": None},
        "blocking_issues": {"type": "array[string]", "children": None},
        "revision_instructions": {"type": "array[string]", "children": None},
        "summary": {"type": "string", "children": None},
        "revised_markdown": {"type": "string", "children": None},
    }
    code = code_node(
        code_id, "Deterministic Review Contract", REVIEW_CODE,
        [
            {"variable": "llm_text", "value_selector": [llm["id"], "text"]},
            {"variable": "mode", "value_selector": [start["id"], "mode"]},
        ],
        outputs,
        720,
    )
    end["data"]["outputs"] = [
        {"variable": name, "value_selector": [code_id, name]} for name in outputs
    ]
    graph["nodes"] = [start, llm, code, end]
    graph["edges"] = [
        edge(start["id"], llm["id"], "start", "llm"),
        edge(llm["id"], code_id),
        edge(code_id, end["id"]),
    ]
    return graph


PATCHERS = {EXTRACT_APP: patch_extract, WRITER_APP: patch_writer, REVIEW_APP: patch_review}
APP_ALIASES = {
    "extract": EXTRACT_APP,
    "writer": WRITER_APP,
    "review": REVIEW_APP,
}


def connect():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        user=os.environ["DB_USERNAME"],
        password=os.environ["DB_PASSWORD"],
        dbname=os.environ["DB_DATABASE"],
    )


def verify() -> None:
    with connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT table_name,string_agg(column_name,',' ORDER BY ordinal_position)
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name IN ('apps','app_model_configs','api_tokens')
            GROUP BY table_name ORDER BY table_name
            """
        )
        for table_name, columns in cursor.fetchall():
            print(json.dumps({"table": table_name, "columns": columns}))
        for app_name in PATCHERS:
            cursor.execute("SELECT id,workflow_id FROM apps WHERE name=%s ORDER BY updated_at DESC", (app_name,))
            for app_id, active_workflow_id in cursor.fetchall():
                print(json.dumps({
                    "app": app_name,
                    "app_id": app_id,
                    "active_workflow_id": active_workflow_id,
                }))
            cursor.execute(
                """
                SELECT w.id,w.version,w.graph
                FROM workflows w JOIN apps a ON a.id=w.app_id
                WHERE a.name=%s AND (
                    w.version='draft' OR w.id=(
                        SELECT w2.id FROM workflows w2
                        WHERE w2.app_id=w.app_id AND w2.version<>'draft'
                        ORDER BY w2.updated_at DESC LIMIT 1
                    )
                )
                ORDER BY w.version='draft'
                """,
                (app_name,),
            )
            for workflow_id, version, raw_graph in cursor.fetchall():
                graph = decode_json_value(raw_graph)
                typed = nodes_by_type(graph)
                node_types = [node.get("data", {}).get("type") for node in graph.get("nodes", [])]
                start = typed.get("start")
                start_variables = sorted(
                    item.get("variable", "") for item in start["data"].get("variables", [])
                ) if start else []
                llm = typed.get("llm", {}).get("data", {})
                temperature = llm.get("model", {}).get("completion_params", {}).get("temperature")
                serialized = json.dumps(graph, ensure_ascii=False)
                print(json.dumps({
                    "app": app_name,
                    "workflow_id": workflow_id,
                    "version": version,
                    "nodes": len(graph.get("nodes", [])),
                    "node_types": node_types,
                    "start_variables": start_variables,
                    "temperature": temperature,
                    "has_contract_filter": "contract_filter" in serialized,
                    "has_output_guard": "Strip Think and Validate" in serialized,
                }, ensure_ascii=False))


def activate_latest() -> None:
    with connect() as connection, connection.cursor() as cursor:
        for app_name in PATCHERS:
            cursor.execute(
                """
                SELECT a.id,w.id,w.version
                FROM apps a JOIN workflows w ON w.app_id=a.id
                WHERE a.name=%s AND w.version<>'draft'
                ORDER BY w.updated_at DESC LIMIT 1
                """,
                (app_name,),
            )
            row = cursor.fetchone()
            if not row:
                raise RuntimeError(f"published workflow not found: {app_name}")
            app_id, workflow_id, version = row
            cursor.execute(
                "UPDATE apps SET workflow_id=%s,updated_at=%s WHERE id=%s",
                (workflow_id, datetime.now(timezone.utc), app_id),
            )
            print(json.dumps({
                "app": app_name,
                "app_id": app_id,
                "active_workflow_id": workflow_id,
                "version": version,
            }))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--activate-latest", action="store_true")
    parser.add_argument("--app", action="append", choices=sorted(APP_ALIASES))
    parser.add_argument("--activate-created", action="store_true")
    parser.add_argument("--update-draft", action="store_true")
    arguments = parser.parse_args()
    if arguments.verify_only:
        verify()
        return
    if arguments.activate_latest:
        activate_latest()
        return
    selected_names = (
        [APP_ALIASES[name] for name in arguments.app]
        if arguments.app
        else list(PATCHERS)
    )
    now = datetime.now(timezone.utc)
    version = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    deployed: list[dict[str, str | bool]] = []
    with connect() as connection, connection.cursor() as cursor:
        for app_name in selected_names:
            patcher = PATCHERS[app_name]
            cursor.execute(
                """
                SELECT w.id,w.tenant_id,w.app_id,w.type,w.graph,w.features,w.created_by,
                       w.environment_variables,w.conversation_variables,w.rag_pipeline_variables
                FROM apps a JOIN workflows w ON w.id=a.workflow_id
                WHERE a.name=%s
                """,
                (app_name,),
            )
            rows = cursor.fetchall()
            if len(rows) != 1:
                raise RuntimeError(
                    f"expected exactly one active app named {app_name!r}, found {len(rows)}"
                )
            row = rows[0]
            _, tenant_id, app_id, workflow_type, graph, features, created_by, env_vars, conversation_vars, rag_vars = row
            patched = patcher(decode_json_value(graph))
            new_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO workflows (
                    id,tenant_id,app_id,type,version,graph,features,created_by,created_at,
                    updated_by,updated_at,environment_variables,conversation_variables,rag_pipeline_variables
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    new_id, tenant_id, app_id, workflow_type, version, json.dumps(patched, ensure_ascii=False),
                    encode_json_value(features), created_by, now, created_by, now,
                    encode_json_value(env_vars),
                    encode_json_value(conversation_vars),
                    encode_json_value(rag_vars),
                ),
            )
            if arguments.update_draft:
                cursor.execute(
                    "UPDATE workflows SET graph=%s,updated_at=%s,updated_by=%s WHERE app_id=%s AND version='draft'",
                    (json.dumps(patched, ensure_ascii=False), now, created_by, app_id),
                )
                if cursor.rowcount == 0:
                    cursor.execute(
                        """
                        INSERT INTO workflows (
                            id,tenant_id,app_id,type,version,graph,features,created_by,created_at,
                            updated_by,updated_at,environment_variables,conversation_variables,rag_pipeline_variables
                        ) VALUES (%s,%s,%s,%s,'draft',%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        (
                            str(uuid.uuid4()), tenant_id, app_id, workflow_type,
                            json.dumps(patched, ensure_ascii=False),
                            encode_json_value(features),
                            created_by, now, created_by, now,
                            encode_json_value(env_vars),
                            encode_json_value(conversation_vars),
                            encode_json_value(rag_vars),
                        ),
                    )
            if arguments.activate_created:
                cursor.execute(
                    "UPDATE apps SET workflow_id=%s,updated_at=%s WHERE id=%s",
                    (new_id, now, app_id),
                )
            else:
                cursor.execute("UPDATE apps SET updated_at=%s WHERE id=%s", (now, app_id))
            deployed.append({
                "app": app_name,
                "workflow_id": new_id,
                "version": version,
                "activated": arguments.activate_created,
            })
    for item in deployed:
        print(json.dumps(item, ensure_ascii=False))


if __name__ == "__main__":
    main()

"""
Template registry: maps filenames to extraction templates.
Supports auto-discovery for unknown document types.
"""
import json, re, os
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).parent
LEARNED_DIR = BASE_DIR / "learned"


# ── Base templates (hand-crafted) ──────────────────────────────

TEMPLATE_NEWSPAPER = {
    "id": "newspaper",
    "description": "Major newspaper — extract only energy-related paragraphs",
    "task": "从报纸中提取所有与能源市场相关的段落。忽略政治、体育、文化、科技（非能源）、生活方式等内容。保留原始英文段落，并为最重要的段落提供忠实中文直译；不得把翻译改写成摘要，不得添加原文没有的判断。如果全文无能源相关内容，返回 relevant: false。",
    "output_schema": {
        "relevant": "boolean — true if any energy-related content found",
        "items": [{
            "category": "原油|成品油|天然气/LNG|电力|航运|政策/制裁|公司动态|新能源",
            "region": "全球|亚太|中国|中东|欧洲|北美|拉美|非洲",
            "signal_type": "价格|供需|政策|事件|技术|观点",
            "direction": "利好|利空|中性|不确定",
            "source_excerpt": "原始英文段落（不超过 300 字）",
            "translated_excerpt": "对应 source_excerpt 的忠实中文直译（不概括、不评论）",
            "key_data": "如有精确数字，保留数值和单位",
            "confidence": "高|中|低"
        }]
    }
}

TEMPLATE_PLATTS = {
    "id": "platts_daily",
    "description": "Platts / Argus industry daily — structured price/supply data",
    "task": "从能源行业日报中逐品类提取价格、价差、供需数据。即使只有一句话提到也要记录。保留精确数值和单位。注意区分即期 vs 远期、FOB vs CIF。每个重要品类同时保留一段直接支撑判断的英文原句及其忠实中文直译，不得把译文改写成摘要。",
    "output_schema": {
        "report_type": "Oilgram|Marketscan|LNG Daily|LPGaswire|Crude Oil Marketwire|Metals Daily|Brazil Fuels|Latin American Wire|Steel Business|Ammonia|Nitrogen|Sulphur|Potash|unknown",
        "commodities": [{
            "name": "Brent|WTI|Dubai|柴油|汽油|航煤|燃料油|LNG|LPG|石脑油|甲醇|氨|尿素|硫磺|钾肥|钢材|油轮运费|...",
            "price": {"value": "number", "unit": "$/bbl|$/mmBtu|$/tonne|$/day", "change": "+/-"},
            "spread": "价差描述 (如 crack spread, arb window)",
            "supply_demand": "供需变化描述",
            "driver": "变动原因",
            "tenor": "即期|M+1|季度|年度",
            "region": "亚太|中东|欧洲|北美|全球",
            "source_excerpt": "直接支撑该条判断的英文原句（不超过 120 词）",
            "translated_excerpt": "source_excerpt 的忠实中文直译（不概括、不评论）",
            "confidence": "高|中|低"
        }]
    }
}

TEMPLATE_REPORT = {
    "id": "report_outlook",
    "description": "Industry/investment bank/consulting report — thesis + forecasts",
    "task": "从行业/投行报告中提取核心判断和预测。区分报告方自己的观点 vs 引用的第三方数据。关注预测的时间窗口。每项关键预测保留一段支撑它的英文原句和忠实中文直译。",
    "output_schema": {
        "publisher": "Shell|BP|JPMorgan|Goldman Sachs|Apollo|Bain|McKinsey|Argus|Makai|Dynamic|G.Moundreas|Breakwave|UBS|JP Morgan|Energy Institute|IEA|OPEC|unknown",
        "thesis": "核心观点（1-2 句中文概括）",
        "forecasts": [{
            "commodity": "商品名称",
            "metric": "价格|需求|供给|产能|投资|贸易流",
            "direction": "上升|下降|持平|波动",
            "magnitude": "具体预测值",
            "time_horizon": "2026H2|2027|2028+|长期",
            "source_excerpt": "支撑预测的英文原句（不超过 120 词）",
            "translated_excerpt": "source_excerpt 的忠实中文直译（不概括、不评论）",
            "confidence": "高|中|低"
        }],
        "key_assumptions": ["关键假设"],
        "risk_factors": ["风险因素"],
        "notable_charts": "值得关注的数据图表描述"
    }
}

TEMPLATE_SHIPPING = {
    "id": "shipping_report",
    "description": "Shipping/shipbroking weekly — freight rates, vessel supply, routes",
    "task": "从航运周报中提取各船型和航线的运价、供需、吨位数据，并为关键变化保留一段英文原句及其忠实中文直译。",
    "output_schema": {
        "broker": "Makai|Dynamic|G.Moundreas|Breakwave|Clarksons|unknown",
        "segments": [{
            "vessel_type": "VLCC|Suezmax|Aframax|MR|LR2|LNG Carrier|LPG Carrier",
            "route": "TD3C|TD20|TC5|TC14|...",
            "rate": {"value": "number", "unit": "$/day|WS points", "change": "+/-"},
            "tonnage": "吨位供需描述",
            "outlook": "短期展望",
            "source_excerpt": "直接支撑判断的英文原句（不超过 120 词）",
            "translated_excerpt": "source_excerpt 的忠实中文直译（不概括、不评论）"
        }]
    }
}

# ── Filename → template mapping ──────────────────────────────

PATTERN_MAP = [
    # Platts / Argus dailies
    (r"(?i)(marketscan|oilgram|lng.?daily|lpgaswire|crude.?oil.?marketwire|metals.?daily|brazil.?fuels|latin.?american.?wire|steel.?business|marketwire|fuels.?daily|ammonia|nitrogen|sulphur|potash)", TEMPLATE_PLATTS),
    # Short-form Platts (HR-xxxxxx, PR-xxxxxx, LW-xxxxxx, SD-xxxxxx)
    (r"(?i)^(hr|pr|lw|sd)[-_]", TEMPLATE_PLATTS),
    # Shipping reports
    (r"(?i)(makai|dynamic.?shipbroking|moundreas|breakwave|clarksons|shipbroking|tanker.?report|product.?tanker)", TEMPLATE_SHIPPING),
    # Industry / bank / consulting reports
    (r"(?i)(report|outlook|review|forecast|survey|statistical|white.?paper|shell|bp[\s_-]|jpm|j\.p\.?morgan|goldman|apollo|bain|mckinsey|ubs|argus|energy.?institute|iea|opec|simpliflying|iata|unep|fuels.?industry|global.?maritime|petrobras|exxon|chevron|sinopec|saudi.?aramco|sustainable.?aviation|global.?wealth|commodity.?price.?outlook|commodity.?outlook|mid.?year|lng.?outlook|green.?economy|seas.?at.?risk)", TEMPLATE_REPORT),
    # Major newspapers
    (r"(?i)(nyt|new.?york.?times|wsj|wall.?street.?journal|financial.?times|ft[\s_-]?\d|guardian|economist|washington.?post|haaretz|bloomberg|ftweek)", TEMPLATE_NEWSPAPER),
]


def get_learned_templates() -> dict:
    """Load all learned templates from disk."""
    learned = {}
    if LEARNED_DIR.exists():
        for f in LEARNED_DIR.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                learned[f.stem] = data
            except Exception:
                pass
    return learned


def match_template(filename: str) -> dict:
    """Match a filename to the best template. Returns template dict + match info."""
    # First check learned patterns
    learned = get_learned_templates()
    for name, tmpl in learned.items():
        patterns = tmpl.get("match_patterns", [])
        for pat in patterns:
            if re.search(pat, filename, re.IGNORECASE):
                return {"template": tmpl, "source": f"learned/{name}", "matched_by": pat}

    # Then check built-in patterns
    for pattern, template in PATTERN_MAP:
        if re.search(pattern, filename, re.IGNORECASE):
            return {"template": template, "source": "base", "matched_by": pattern}

    # No match — trigger auto-discovery
    return {"template": None, "source": "unknown", "matched_by": None}


def save_learned_template(name: str, template: dict, match_patterns: list[str]):
    """Persist a newly discovered template."""
    LEARNED_DIR.mkdir(parents=True, exist_ok=True)
    tmpl = {**template, "match_patterns": match_patterns, "learned_at": ""}
    path = LEARNED_DIR / f"{name}.json"
    path.write_text(json.dumps(tmpl, ensure_ascii=False, indent=2), encoding="utf-8")


AUTO_DISCOVERY_PROMPT = """你是一个能源行业文档分析助手。请分析以下文档内容，完成两个任务：

1. 判断文档类型：这是什么类型的文档？（例如：航运周报、化肥市场日报、投行宏观报告、学术论文等）
2. 设计提取模板：针对这种文档类型，应该提取哪些结构化字段？

返回 JSON：
{
  "doc_type": "简短的类型描述（中文，10字以内）",
  "doc_type_en": "英文slug（小写+下划线）",
  "template": {
    "id": "与doc_type_en相同",
    "description": "一句话描述此模板用途",
    "task": "给LLM的提取指令（中文）",
    "output_schema": {
      "字段名": "字段说明和可选值"
    }
  },
  "match_suggestions": ["用于匹配此类文件的文件名正则表达式1", "正则2"]
}

文档文件名：{filename}
文档内容（前3000字）：{preview}
"""

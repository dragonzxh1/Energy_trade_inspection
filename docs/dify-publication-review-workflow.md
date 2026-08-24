# Dify 发布终审工作流

## 用途

该工作流只审查仓库生成的最终 Markdown，使用独立环境变量：

```env
DIFY_WORKFLOW_API_KEY_REVIEW=
```

不得复用提取、写作或聚合密钥。

## Start 输入

- `mode`：`review` 或 `revise`。
- `date`：报告日期。
- `report_markdown`：待审或待修订 Markdown。
- `extractions`：仓库压缩后的结构化证据。
- `previous_review`：上一轮审校 JSON；首审传 `{}`。

所有变量都必须通过 Dify 变量选择器插入，禁止手写伪占位符。

## Review 输出

```json
{
  "decision": "pass|reject",
  "score": 0,
  "dimension_scores": {
    "factuality": 0,
    "translation_fidelity": 0,
    "analytical_depth": 0,
    "readability": 0,
    "publication_safety": 0
  },
  "blocking_issues": [],
  "revision_instructions": [],
  "summary": ""
}
```

评分：事实与数字 25、翻译忠实度 20、分析深度 25、可读性 15、公众号安全与风格 15。

以下问题必须阻断：日期错误、虚构事实、数字/单位/主体错误、实质性误译、结论与证据冲突、文件名泄露、`<think>`、模板占位符、AI 相关措辞和危险 HTML。

## Revise 输出

```json
{"revised_markdown":"完整 Markdown 正文"}
```

修订只能使用结构化证据中的事实、数字、主体和原文摘录，不得加入新事实、文件名、HTML 或思考过程。

## 数字与翻译规则

- 数字表达和单位保持原文字符形式，不得换算或本地化。
- 原文 `40 million` 在中文译文中仍保留 `40 million`，不得改成 `4000万`。
- 原文 `67,000 b/d` 不得改成 `6.7万桶/日`。
- 这种原样保留不属于中文编辑缺陷。
- 必须保留主语、宾语和因果关系，例如 `X halts Y amid Z review` 表示暂停的是 `Y`，`Z` 是原因。

## 放行规则

- 本地审计与 Dify 审校必须同时通过。
- 总分不低于 85，且阻断项为空。
- `pass` 时 `revision_instructions` 必须为空。
- 全链路只允许一次自动修订；复审仍失败则拒绝发布。
- 审校失败、HTTP 错误或输出格式错误都按失败关闭处理。
- 审校记录保存到 `reports/market_pipeline/quality/<date>_llm_review.json`。

## 已验证生产配置

- 模型：`deepseek-v4-pro`。
- 温度：终审应用按确定性配置运行。
- 输入证据上限：仓库控制在 98,000 字符以内，低于 Dify 100,000 字符限制。
- HTML：不在 Dify 中生成，由仓库统一渲染。

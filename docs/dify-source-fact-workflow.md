# Dify 原子事实工作流合同

## 用途

该工作流只处理一个 `DocumentSection`，只返回 `source_fact`。它不计算指标、不判断主线、不写日报。

复用 `DIFY_WORKFLOW_API_KEY_EXTRACT`。Start 节点字段保持：

- `mode`
- `filename`
- `date`
- `raw_text`
- `template_id`
- `template_task`
- `template_schema`

当 `mode=source_fact` 时，LLM 必须严格执行 `template_task`，以 `template_schema` 输出 JSON。结束节点直接暴露包含 `facts` 的 JSON，不得增加 Markdown 代码块或 `<think>`。

## 强约束

- 一条事实只表达一个核心信息。
- 价格、涨跌和驱动必须拆分。
- `evidence_text` 必须逐字来自 `raw_text`。
- 数字必须保留原始单位；无单位数字不得猜测单位。
- 保留归因、条件、不确定语气。
- 不得计算、预测、评论或补充外部知识。
- 无市场事实时返回 `{"schema_version":"market-fact.v1","facts":[]}`。
- 单章节最多返回 12 条最高置信事实；密集价格表由本地 `ParsedTable` 路径处理。

本地 worker 会覆盖来源、章节、日期和页码绑定，并拒绝不在章节原文中的证据。

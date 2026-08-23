# Dify 文章写作工作流

## 作用

该应用只把已通过本地核验的编辑判断和代表性证据写成中文公众号文章。它不负责事实提取、信号评分、终审或 HTML 渲染。

环境变量：

```env
DIFY_WORKFLOW_API_KEY_WRITER=
```

缺失该密钥时，发布任务直接失败，不会复用提取应用。

## Start 输入

为复用仓库的统一 Dify 调用器，字段固定为：

- `mode`：`structured_article`
- `filename`：固定 `editorial-view.json`
- `date`
- `raw_text`：仓库生成的写作证据 JSON
- `template_id`：`published-article.v1`
- `template_task`：少于 1024 字符的写作要求
- `template_schema`：文章输出 JSON Schema

## 输出

```json
{
  "title": "文章标题",
  "summary": "文章摘要",
  "report_markdown": "完整 Markdown"
}
```

不得输出 Markdown 代码围栏、解释文字或 `<think>`。

## Dify 节点

```text
Start → DeepSeek LLM → End
```

生产模型为 `deepseek-v4-pro`，温度为 `0`。系统提示必须通过变量选择器直接插入：

```text
{{#1783330609588.template_task#}}
{{#1783330609588.template_schema#}}
```

节点 ID 可能因重建而变化，重建时必须重新使用变量选择器，不要复制旧 ID。

## 输入约束

- `raw_text` 只包含主线、反向信号及其代表性事实。
- 每个信号和对应证据必须成套发送。
- 不发送完整 PDF、所有市场信号、无关指标或模型历史输出。
- 原文摘录最多三段。
- 数字、单位、主体、主客体、条件和不确定语气保持原样。
- 允许解释传导机制，但证据不足必须明确写成待验证问题。

## 仓库侧检查

仓库会：

1. 补齐真正的文章标题。
2. 把六个固定栏目统一为二级标题。
3. 检查原文逐字引用。
4. 拒绝新数字、文件名、内部 ID、AI 措辞和结构缺失。
5. 只把本地检查通过的 Markdown 送入独立终审工作流。

## 验证样本

2026-07-10 的生产影子稿已验证：

- 主线信号：83 分。
- 写作输入：9 条代表性事实、2 个相关信号、1 个可追溯指标。
- 本地审计：通过。
- Dify 终审：99 分，无阻断项。
- 最终状态：`shadow_saved`。

## 回滚

Dify 数据库修改前的备份位于 Dify 服务器：

```text
/home/ubuntu/eti-publication-review-workflows-20260712T2200.json
/home/ubuntu/eti-article-writer-workflow-20260712.json
```

文章写作应用应通过 Dify 控制台导出后另行长期保存。回滚仓库代码时同时恢复 `article.py` 和 `publication_worker.py`，但不得把正式发布模式改为 `active`。

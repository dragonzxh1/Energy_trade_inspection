# Platts Summary OCR 隔离试验

## 安全边界

- 输入仅来自 `telegram:quotes-summary` 图片附件。
- 输出仅写入 `reports/ocr_trials/platts_summary/`。
- 不连接 PostgreSQL 写接口，不创建事实、价格、信号、文章或微信草稿。
- 标准答案必须标记为 `human_verified` 才计入准确率。
- 任一核心指标未达标时，结论固定为 `do_not_integrate_production`。

## 环境

```bash
python3 -m venv .venv-platts-trials
.venv-platts-trials/bin/pip install -r platts_ocr/requirements-trials.txt
```

PaddleOCR 和 PP-StructureV3 必须单实例运行，不并发加载模型。模板 Tesseract 可按图片并行，降低完整双跑耗时。

## 输出目录

```text
reports/ocr_trials/platts_summary/
├── samples/
├── manifest.json
├── ground_truth/
├── run_1/
├── run_2/
├── raw/
├── errors/
├── evaluation.json
└── comparison.md
```

## 命令

初始化人工标准答案模板：

```bash
python -m platts_ocr.trials.cli init-ground-truth \
  --samples reports/ocr_trials/platts_summary/samples \
  --output reports/ocr_trials/platts_summary/ground_truth
```

模板解析器运行两次；`--workers` 只用于独立图片的 Tesseract 并行：

```bash
python -m platts_ocr.trials.cli run \
  --samples reports/ocr_trials/platts_summary/samples \
  --output reports/ocr_trials/platts_summary \
  --parsers template_tesseract \
  --repeat 2 \
  --workers 8
```

PaddleOCR 和 PP-StructureV3 必须串行：

```bash
python -m platts_ocr.trials.cli run \
  --samples reports/ocr_trials/platts_summary/samples \
  --output reports/ocr_trials/platts_summary \
  --parsers img2table_paddle,ppstructure_v3 \
  --repeat 2 \
  --workers 1
```

评估：

```bash
python -m platts_ocr.trials.cli evaluate \
  --samples reports/ocr_trials/platts_summary/samples \
  --output reports/ocr_trials/platts_summary \
  --ground-truth reports/ocr_trials/platts_summary/ground_truth
```

## 人工标准答案

- 必须查看原图逐格录入，不得从任一 OCR 输出自动确认。
- 日期必须来自图片顶部 `PLATTS SUMMARY` 标题。
- 原始值与标准化值同时保留。
- `N/A` 保存为 `null`，不得写成零。
- 完成复核后将 `verification_status` 改为 `human_verified`，填写复核人和时间。

## 验收阈值

- 日期准确率 100%。
- 产品、地区、代码准确率不低于 99%。
- 价格、Change、Spread 关键数字准确率不低于 99.5%。
- 正负号和单位准确率 100%。
- 行列对应准确率不低于 99.5%。
- 重复运行一致率 100%。
- 无法确认字段进入人工复核率 100%。

试验通过也不自动接入生产；生产接入必须另开迭代，并先观察 20 张新图片。

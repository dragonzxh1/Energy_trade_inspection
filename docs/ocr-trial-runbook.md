# PaddleOCR-VL 隔离试验

该试验不接入日报主链路，也不会改变提取缓存、质量状态或公众号发布状态。

## 配置

在私有 `.env.local` 中填写：

```env
XFYUN_MAAS_BASE_URL=https://maas-api.cn-huabei-1.xf-yun.com/v2
XFYUN_MAAS_API_KEY=
XFYUN_PADDLEOCR_MODEL_ID=
XFYUN_OCR_PRICE_PER_MILLION_TOKENS=0
```

API Key 和模型 ID 必须以讯飞“服务管控 → 模型服务列表 → 调用信息”为准。2026 年新发布服务使用 v2 地址；PaddleOCR-VL-1.6 当前模型广场标价为 0 元/百万 tokens，但试验结果仍应与控制台账单核对。

官方资料：

- https://www.xfyun.cn/doc/spark/%E5%9B%BE%E5%83%8F%E7%90%86%E8%A7%A3API-http.html
- https://maas.xfyun.cn/modelSquare

## 执行

```bash
python intelligence/ocr_trial.py \
  "/var/www/eti/obsidian-vault/attachments/platts_digits/2026-07/FT0107US.pdf" \
  "/var/www/eti/obsidian-vault/attachments/platts_digits/2026-07/NYT International 0107.pdf" \
  --pages 2
```

每份 PDF 最多测试两页。已有 500 字以上文本层的 PDF 自动跳过。

## 输出与验收

输出目录：`reports/ocr_trials/`。

- 每份文件的 OCR 文本
- 页面文本字符数与能源段落数量
- 页面及总响应时间
- token usage 与按配置单价计算的成本估算
- 错误信息

只有文本覆盖率和能源段落可用性明显优于“直接跳过”时，才另行评估生产接入；本次试验本身不改变生产策略。

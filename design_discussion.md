# Energy Trade Inspection Platform — 产品设计讨论记录

**日期：** 2026-04-04
**最后更新：** 2026-04-04（第二次）
**状态：** 进行中，未完成

---

## 一、产品方向与目标

**产品定位：** 面向国际中小能源贸易商的一站式交易对手尽调平台，覆盖公司真实性、船舶合规性、储运设施核实三个维度。

**核心价值主张：** 价格远低于 Windward / Kpler / Refinitiv World-Check 等企业级工具，专注中小贸易商。

**目标市场：** 国际市场为主，不偏重中国市场。能源贸易核心枢纽：
- 欧洲：ARA（阿姆斯特丹-鹿特丹-安特卫普）、地中海走廊、英国北海
- 中东/非洲：富查伊拉（UAE）、迪拜 DMCC
- 亚太：新加坡
- 美洲：美国墨西哥湾（Houston）

**商业模式：** 付费订阅 SaaS（B2B）

---

## 二、核心查询对象（四维）

### 1. 公司主体（Company Profile）
- 注册信息核查（Companies House / ACRA / OpenCorporates）
- 股权结构与 UBO 穿透
- 关联公司网络
- 制裁名单状态
- 法律诉讼 / 破产记录
- 监管执法记录

### 2. 船舶（Vessel Profile）
- 基础信息（IMO / 旗帜 / 船级 / 所有权链）
- PSC 扣押记录（Paris MOU / Tokyo MOU）
- AIS 轨迹 + 黑暗航行检测
- Q88 交叉验真
- 船舶扣押（Vessel Arrest）记录

### 3. 储运设施（Terminal Profile）
- 设施注册核实（EPA RMP / BRZO / MPA 等）
- 运营商真实性核查
- 卫星坐标验证（Google Maps Static API）
- 白名单比对（Vopak / Oiltanking 等知名运营商）

### 4. 自然人（Personal Profile）
- 制裁名单中的个人
- 被取消资格董事（Disqualified Directors）
- 监管执法中的个人（CFTC / FCA 禁令等）
- 关联公司网络（穿透壳公司的关键锚点）
- 护照号哈希匹配（存哈希，不存原文）
- PEP（政治敏感人物）标记

---

## 三、核心评估框架：真实性（Authenticity）优先

**重要原则：制裁状态与真实性评分独立展示，互不决定。**

大量能源贸易欺诈方：
- 完全不在任何制裁名单
- 公司刚注册数月
- 声称控制储罐/船舶，实际无关
- 文件造假，参数与真实数据不符

### 真实性评分体系（0-100）

| 维度 | 权重 | 内容 |
|------|------|------|
| 主体存在性（Entity Existence） | 25分 | 注册可核实、注册时间、注册地风险 |
| 资产真实性（Asset Reality） | 30分 | 船舶所有权、储罐授权、Q88自洽 |
| 交易历史真实性（Trading Track Record） | 25分 | 可查证贸易记录、规模匹配 |
| 文件自洽性（Document Consistency） | 10分 | 多文件交叉核实 |
| 社区信誉（Community Reputation） | 10分 | 用户标记、正向验证 |

评分等级：
- 90-100：Verified（高度核实）
- 70-89：Mostly Verified（基本核实）
- 50-69：Partially Verified（部分核实）
- 30-49：Insufficient Data（核实不足）
- 0-29：Suspicious（存在疑点）

---

## 四、官方数据源体系

### 制裁名单（通过 OpenSanctions 统一接入）
- OFAC SDN List（美国）
- EU Consolidated Financial Sanctions List
- UN Security Council Sanctions
- UK OFSI List
- 澳大利亚 DFAT 等

### 港口国监控（PSC）
- Paris MOU（欧洲+北大西洋）
- Tokyo MOU（亚太）
- US Coast Guard PSC
- Equasis（整合多个 MOU 数据）

### 公司注册数据库
- 英国：Companies House API（免费，质量极高）
- 新加坡：ACRA BizFile
- 阿联酋：DMCC 官方目录
- 瑞士：Zefix（免费）
- 全球：OpenCorporates API

### 储罐设施数据库
| 地区 | 数据库 | 特点 |
|------|--------|------|
| 美国 | EPA RMP | 完全公开 API |
| 欧盟 | SEVESO III 目录 | 各成员国公示 |
| 英国 | HSE COMAH Sites | 强制备案 |
| 新加坡 | MPA / EMA | 持牌设施 |
| 荷兰 | BRZO | 鹿特丹港区 |
| 富查伊拉 | FOIZ 官方成员 | 中东核心 |

国际知名油库运营商白名单：Vopak、Oiltanking、Stolthaven、Odfjell、VTTI、LBC、Rubis 等

### 船舶数据
- IMO GISIS
- Equasis
- 各旗国船舶登记处（巴拿马 SEGUMAR / 马绍尔群岛 IRI / 利比里亚 LISCR）
- MarineTraffic / VesselFinder（AIS 轨迹，Phase 2）

### 法律与执法记录
- CFTC 执法行动（商品欺诈）
- OFAC 民事罚款
- FCA / MAS 执法公告
- 英国法院判决（BAILII，免费）
- 破产记录（Companies House + ACRA）
- CourtListener（美国联邦法院，免费）
- 新加坡高院判决（免费）

### 贸易记录
- Import Genius / Panjiva / ImportYeti（提单数据，付费，Phase 2+）

---

## 五、储罐欺诈专项

**储罐欺诈类型：**
1. 储罐本身不存在
2. 储罐存在但与声称者无关
3. 双重/多重承诺（最高发）——同一罐容多笔承诺，如青岛港 2014 年事件
4. 库存欺诈——伪造量油检验报告
5. 检验公司欺诈——伪造 SGS/Intertek 等报告

**地理高发区：**
- 富查伊拉（中东最高发）
- 马耳他/直布罗陀（地中海）
- 新加坡（历史高发，2020 年兴隆集团 30 亿美元暴雷）
- 西非（尼日利亚、贝宁）

**防重复质押检测：**
- 同一储罐/仓单编号被多用户查询时自动预警
- 允许用户提交"我持有该仓单"声明，冲突时告警

---

## 六、用户评价机制

**设计原则：结构化评价 + 强身份验证，规避诽谤风险**

评价维度（仅验证账户可提交）：
- 付款及时性
- 单据准确性
- 沟通响应速度
- 合同履约情况
- 综合合规印象

**身份验证：** 企业邮箱绑定或上传公司注册文件审核

**法律设计：** 不允许"黑名单"，使用"风险标记"；被标记方有申诉机制；用户标记明确标注"未经核实"

---

## 七、合同智能分析模块（LLM）

### 文档处理管道

**输入类型分布：**
- 原生 PDF（可直接提取）：~30%
- 扫描 PDF：~45%
- 传真件扫描（质量差）：~15%
- 图片（JPG/PNG/TIFF）：~5%
- Word 文档：~5%

**OCR 分层策略：**
1. 原生 PDF → pdfplumber 直接提取
2. 扫描件 → AWS Textract（表格识别最强）
3. 复杂版式/手写批注 → Claude Vision API
4. 兜底 → Tesseract（开源，低成本）

**特殊处理：**
- 手写批注识别和定位
- 公章/印章遮挡区域推断
- 多语言混排（英文+阿拉伯/中文批注）
- 低置信度区域标注，提示人工确认

**隐私原则：**
- 默认处理但不存储，合同原文处理后立即销毁
- 护照号/银行账户在调用 LLM 前脱敏（哈希替换）
- Enterprise 客户支持私有化部署（Bedrock / Azure OpenAI）

### 合同信息提取

**实体提取：**
- 公司全称（各文件不同写法）
- 注册号、注册地址 vs 运营地址（不一致是风险信号）
- 授权签署人姓名+职位
- 联系邮箱域名（验证注册时间）
- 收款银行账户受益人（是否与卖方一致）
- 船名、IMO号、储罐/终端信息
- 第三方机构（检验公司/保险公司/开证行）

**条款提取：**
- 货物品种/规格
- 数量+单位（含容差）
- 价格+计价基准（Platts/Argus+升贴水）
- 交货条件（Incoterms+港口）
- 付款方式和时间
- 检验标准
- 适用法律和争议解决

### 贸易形式分类与核查规则

**主要贸易形式：**

| 形式 | 全称 | 关键风险点 |
|------|------|-----------|
| FOB | Free on Board | 买方提名船舶核查、装港检验 |
| CIF | Cost, Insurance, Freight | 保险单真实性（受益人必须是买方）|
| CFR | Cost and Freight | — |
| DES | Delivered Ex Ship | — |
| TTV | Tank to Vessel | 储罐真实性+货权证明（最关键）|
| VTT | Vessel to Tank | — |
| TTT | Tank to Tank | 双罐核查+防多重承诺 |
| Ex-Tank | — | — |
| In-Tank Transfer | 罐内过户 | 终端运营商 Transfer Note 真实性 |

**FOB 典型欺诈：** 虚报船舶位置，拿预付款后船舶"未到达"

**CIF 典型欺诈：** 伪造保险单，保险受益人是卖方而非买方

**TTV 典型欺诈：** 储罐已抵押/已卖出，伪造货权证明，量油报告造假

**TTT 典型欺诈：** 完全纸面交易货物未移动，同一批货多份 TTT 合同

**In-Tank 典型欺诈：** 同一仓单多笔过户/质押（青岛港事件核心手法）

### 条款风险检测规则

**付款条款：**
- Critical：要求全额预付 / 收款方与卖方不一致 / 付款至个人账户或加密货币
- High：预付比例 > 30% 且无 LC 保障
- Medium：非标准付款货币 / 无 LC 要求（大额交易）

**检验条款：**
- High：无独立第三方检验 / 仅卖方指定检验公司 / 数量以卖方量油为准
- Medium：检验公司非国际知名机构

**文件条款：**
- High：缺少提单要求 / 接受复印件作为正本
- Medium：文件提交窗口过长

**合同结构：**
- High：各处公司名称不一致 / 签署人无法在注册信息中核实
- Medium：适用法律为高风险司法区 / 仲裁地无法律执行力

**各贸易形式标准文件清单（缺失即标记风险）：**
- FOB：提单（B/L）、装港检验报告、出口报关单
- CIF：提单、保险单（High）、装港检验报告
- TTV：Tank Receipt（High）、装前/装后检验报告、提单、终端确认函
- TTT：双方 Tank Receipt、Transfer Confirmation、独立检验报告
- In-Tank：终端 Transfer Note（Critical）

---

## 八、GEO（生成式引擎优化）策略

**目标：** 成为 AI（Perplexity / ChatGPT / Claude）回答能源贸易合规问题时的首选引用来源

**关键实现：**

1. **规范化实体 URL：**
   - `/company/{canonical-name}-{registration-number}`
   - `/vessel/{imo-number}-{vessel-name}`
   - `/terminal/{country}-{city}-{facility-name}`

2. **Schema.org JSON-LD 结构化标记**（每个实体页从第一天起）

3. **llms.txt 文件**（告知 AI 爬虫哪些内容可索引）

4. **内容资产：**
   - 能源贸易合规词汇表（/glossary/）
   - 定期欺诈预警报告（/alerts/）
   - 结构化 FAQ（/faq/）
   - 季度/年度公开数据报告

5. **robots.txt 策略：** 允许 GPTBot / PerplexityBot / ClaudeBot 索引公开内容

6. **渲染策略：** 实体页用 ISR（增量静态再生成），AI 爬虫可抓取

7. **公开 API 端点：** 允许 AI 平台直接调用查询制裁状态（GEO 最高形态：成为 AI 的实时数据源）

---

## 九、技术栈选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 前端 | Next.js 14 (App Router) + TypeScript | SSR/ISR 满足 GEO 需求 |
| UI | Shadcn/UI + Tailwind CSS | B2B 适合，无样式锁定 |
| 后端 | Python + FastAPI | 数据处理、NLP、爬虫生态优势 |
| 主数据库 | PostgreSQL | 关系数据，成熟稳定 |
| 搜索引擎 | Elasticsearch | 多语言实体名称模糊匹配 |
| 图数据库 | Neo4j | 公司-人-船关联关系追踪 |
| 缓存/队列 | Redis + Celery | 数据同步任务管道 |
| 制裁数据 | OpenSanctions（自托管） | 整合 100+ 名单，省 80% 集成工作 |
| 支付 | Stripe（含 Stripe Tax） | 订阅管理+国际税务合规 |
| 报告生成 | WeasyPrint（主）/ Puppeteer（备） | Python 栈统一 |
| 云基础设施 | AWS + Cloudflare | ECS Fargate / RDS / OpenSearch |
| 合同 OCR | AWS Textract + Claude Vision API | 分层处理不同质量文件 |

**Elasticsearch 配置要点：**
- 标准分析器 + Phonetic 分析器 + ICU 分析器（多语言）
- 法律实体后缀忽略（SA/Ltd/BV/LLC 同等对待）
- 制裁实体已知别名加权

**MVP 阶段简化：**
- Neo4j → 暂用 PostgreSQL 递归查询（关系 < 3 层时够用）
- Elasticsearch → 暂用 pg_trgm 全文搜索
- Celery → 暂用 cron job
- ECS → 暂用单台 EC2 + Docker Compose

---

## 十、订阅与付费设计

### 订阅层级

| 层级 | 价格 | 核心内容 | 目标客户 |
|------|------|---------|---------|
| Free | $0/月 | 每月 5 次查询，仅制裁状态（Listed/Not Listed）| 引流 |
| Starter | $99/月 或 $990/年 | 100次/月、完整制裁详情、公司+船舶基础档案、1席位 | 独立贸易商 |
| Professional ★ | $299/月 或 $2,988/年 | 无限查询、自然人档案、AIS轨迹、法律记录、储罐基础核查、合同分析(20份/月)、3席位 | 中型贸易公司 |
| Enterprise | $1,500+/月（定制） | 全功能+API+批量+无限监控+Q88验真+私有化部署+SSO | 银行/保险/大型能源公司 |

### 额外付费点

| 付费点 | 定价 | 场景 |
|--------|------|------|
| 额外查询包 | $29/50次、$89/200次 | Starter 超额弹性扩展 |
| 单次完整报告 | $49-$99 | Free 用户偶发需求 |
| 单次储罐核查报告 | $79 | — |
| 单次合同分析 | $99-$149 | — |
| 实体监控（叠加计费）| $19/月（10个）、$49/月（50个）、$149/月（200个）| 合同执行期持续监控 |
| API 按量计费 | 基础$299/月（含1000次），超额$0.15/次 | Enterprise 弹性扩展 |
| 额外席位 | $49/人/月 | Professional 团队扩大 |

### 免费试用
- 14天 Professional 完整体验，无需信用卡
- 试用结束降级为 Free，数据保留

### 国际支付方式
- 信用卡/借记卡（Stripe）
- SEPA Direct Debit（欧洲）
- ACH（美国）
- 电汇/发票（Enterprise）
- 支持 USD / EUR / GBP / SGD 计价
- Stripe Tax 自动处理 VAT/GST

---

## 十一、法律合规框架

| 风险类型 | 解决方案 |
|---------|---------|
| GDPR/隐私法 | 以"公共利益"和"合法利益"为合法性基础 |
| 诽谤风险 | 仅展示官方来源信息；用户标记明确标注"未经核实" |
| 被遗忘权 | 官方制裁数据不删除；用户提交数据设申诉机制 |
| 错误匹配 | 必须多字段匹配（姓名+国籍+出生年+护照号），单字段不显示结果 |
| 数据安全 | 护照号等字段 SHA-256 哈希存储，不保存原文；合同分析后原文销毁 |
| 涉密文件 | Enterprise 提供私有化部署，合同不离开客户环境 |

---

## 十二、三阶段开发路线（框架）

### Phase 1 — MVP（核心查询引擎）
1. 统一搜索入口（公司名/IMO号/船名）
2. 制裁名单聚合筛查（OpenSanctions）
3. 公司基础档案（Companies House / OpenCorporates）
4. 船舶合规档案（Equasis + Paris/Tokyo MOU）
5. 真实性评分（自动生成 Low/Medium/High/Critical）
6. 用户风险标记系统（验证账户）
7. PDF 报告导出

**不做：** AIS 实时轨迹、法院记录、储罐深度核查、新闻舆情、合同分析

### Phase 2 — 深度核查层
1. AIS 轨迹接入（MarineTraffic Enterprise API）
2. 黑暗航行检测
3. 法律与执法记录（CFTC / FCA / BAILII / 破产）
4. 新闻舆情聚合（NLP 实体识别）
5. 股权穿透（初步）
6. 储罐核查（基础版）
7. **合同智能分析模块（LLM + OCR）**

### Phase 3 — 企业级与生态
1. Q88 交叉验证
2. 完整 UBO 穿透（OpenOwnership）
3. 批量查询与持续监控告警
4. API 接入（按量计费）
5. 储罐深度核查（富查伊拉/马耳他/直布罗陀）
6. 社区数据网络（匿名化行业信息共享）

---

## 十三、竞品分析

| 竞品 | 覆盖范围 | 本平台差异化 |
|------|---------|------------|
| Windward | 船舶数据+大宗商品流向 | 不做公司/储罐欺诈核查 |
| Kpler | 大宗商品流向分析 | 不做合规/欺诈核查 |
| Refinitiv World-Check | 制裁/PEP 名单 | 不做资产真实性验证 |
| 三者均无 | — | 公司+船舶+储罐+自然人四维核查 + 合同分析 |

**切入点：** 中小贸易商无力承担企业级工具，但有强烈的尽调需求。

---

## 十四、船舶数据源策略（已确认）

**决策：** 使用 MarineTraffic Enterprise API 作为主力船舶数据源，替代 Equasis 的自动抓取方案。

**覆盖范围：**
- 船舶静态信息（船型/吨位/建造年份/旗帜/船级）
- 实时 AIS 位置和航行状态
- 历史轨迹（黑暗航行检测）
- 港口到港/离港记录
- 部分 PSC 检验记录

**仍需独立获取：**
- Paris MOU / Tokyo MOU 完整扣押记录（按需查询+缓存，法律风险低）
- IMO GISIS 基础注册信息（免费，补充 MarineTraffic）

**分阶段接入策略：**

| 阶段 | 船舶数据策略 | 理由 |
|------|------------|------|
| Phase 1 | IMO GISIS（免费）+ OpenSanctions 中的船舶制裁数据 | 控制初期成本 |
| Phase 2 | 接入 MarineTraffic 基础套餐，开放 AIS + 黑暗航行检测 | 作为 Pro 层核心卖点 |
| Phase 3 | 根据用量升级，或评估 Spire Maritime / VesselFinder 性价比 | — |

**成本传递：** AIS 数据成本通过 Pro 层溢价覆盖。

---

## 十五、Phase 1 开发路线图（详细）

### 精确范围

**纳入 Phase 1：**

| 功能模块 | 数据来源 | 成本 |
|---------|---------|------|
| 制裁名单筛查 | OpenSanctions（自托管） | 免费 |
| 公司档案（英国） | Companies House API | 免费 |
| 公司档案（全球） | OpenCorporates API | 按查询量，有免费额度 |
| 船舶基础档案 | IMO GISIS | 免费 |
| PSC 扣押记录 | Paris MOU / Tokyo MOU（按需+缓存） | 免费 |
| 被取消资格董事 | Companies House Disqualified Directors | 免费 |
| 自然人制裁查询 | OpenSanctions（含个人记录） | 免费 |
| 真实性评分 | 内部逻辑 | — |
| 用户风险标记 | 自有数据库 | — |
| PDF 报告导出 | WeasyPrint | 免费 |
| 实体公开页（GEO） | Next.js ISR | — |
| 订阅与支付 | Stripe | 交易手续费 |

**明确排除（Phase 2）：**
- AIS 轨迹 / 黑暗航行检测（MarineTraffic）
- 法律与执法记录（CFTC / BAILII / 破产）
- 新闻舆情聚合
- 储罐核查
- 合同智能分析（OCR + LLM）
- 股权穿透图谱

---

### 六个构建里程碑

#### M1：数据管道

**目标：** 所有 Phase 1 数据源稳定流入数据库

```
OpenSanctions 自托管部署
→ 每日自动增量同步
→ 实体标准化（名称/别名/国籍）

Companies House API 接入
→ 公司基础信息 + 董事列表
→ 被取消资格董事名单

IMO GISIS 船舶数据
→ 按 IMO 号查询，结果缓存 30 天

Paris MOU / Tokyo MOU
→ 按船名/IMO 号按需查询
→ 结果缓存 7 天
```

**完成标准：** 给定任意公司名/IMO号能从数据库返回对应数据；OpenSanctions 每日增量更新正常运行

---

#### M2：核心搜索 API

**目标：** 后端搜索逻辑完整可用，响应时间 < 300ms

Phase 1 使用 PostgreSQL pg_trgm（不上 Elasticsearch，降低复杂度）：

```sql
CREATE EXTENSION pg_trgm;

CREATE INDEX idx_entities_name_trgm
ON entities USING gin(name gin_trgm_ops);

SELECT name, similarity(name, '查询词') AS sim
FROM entities
WHERE name % '查询词'
  AND entity_type = 'company'
ORDER BY sim DESC
LIMIT 20;
```

法律实体后缀标准化（必须做）：
- SA / Ltd / Limited / Inc / Corp / BV / GmbH / Pte / FZE / FZCO / LLC / Plc
- 查询时去除后缀后比对，避免"Acme Ltd"查不到"Acme FZE"

搜索结果返回字段：实体ID、类型、规范名、别名、匹配度、真实性评分等级、制裁状态、风险等级、最后更新时间

**完成标准：** 同名实体不同写法能召回正确结果；制裁实体别名（阿拉伯文/西里尔转写）能匹配

---

#### M3：实体档案页 + GEO 结构

**目标：** 每个实体有规范公开页面，AI 爬虫可抓取

URL 规范：
- `/company/{slug}-{registration-number}`
- `/vessel/{imo}-{vessel-name}`
- `/person/{encoded-id}`

内容分层：

| 层级 | 内容 | 访问要求 |
|------|------|---------|
| 公开层 | 实体名、制裁状态、注册状态、风险等级（Low/Medium/High/Critical） | 无需登录 |
| 付费层 | 完整制裁详情、董事列表、关联公司、用户标记、评分明细 | 订阅用户 |

每个页面必须包含：
- Schema.org JSON-LD 结构化数据
- `<time datetime="">` 标签标注数据更新时间
- 来源链接直接指向官方原始数据

渲染策略：实体页 ISR（每小时重新生成），制裁状态变化时主动触发重新生成

**完成标准：** 实体页在 Google Search Console 中显示已建立索引；llms.txt 和 robots.txt 部署完毕

---

#### M4：真实性评分引擎

**目标：** 自动生成可解释的真实性评分

Phase 1 可用数据范围内的评分实现：

| 维度 | 满分 | Phase 1 实现内容 |
|------|------|----------------|
| 主体存在性 | 25 | 注册信息可核实+10；注册时间>2年+8；注册地风险评级+7 |
| 资产真实性 | 30 | 关联船舶 IMO 可核实+10/艘（上限15）；其余标注"数据不足" |
| 交易历史 | 25 | Phase 1 全部标注"数据不足"，不评分 |
| 文件自洽性 | 10 | Phase 1 仅在有用户标记时评估 |
| 社区信誉 | 10 | 风险标记扣分（-5/个）；正向验证+3/个 |

**关键设计原则：**
- 数据不足时明确标注，不用低分暗示欺诈
- 评分必须附带置信度说明
- 制裁状态独立展示，不影响真实性评分

**完成标准：** 对已知真实公司和已知历史欺诈案例评分，方向准确性人工验证

---

#### M5：用户系统 + 支付 + 风险标记

**目标：** 完整的账户注册、订阅管理、风险标记流程

注册流程：企业邮箱注册 → 邮箱验证 → 14天 Pro 试用激活 → 到期前72小时提醒 → 选择订阅或降级 Free

风险标记类型（结构化，不允许自由文本）：
- 付款违约
- 单据造假
- 身份冒用
- 储罐欺诈
- 合同欺诈
- 其他合规问题

首次标记需要补充公司验证信息（企业邮箱或上传注册文件），审核通过后公示标记类型和时间，不公示提交方身份。

Stripe 集成：Checkout Session（新订阅）、Customer Portal（自助管理）、Webhook（支付状态变化）、Stripe Tax（VAT/GST 自动计算）

**完成标准：** 完整走通注册→试用→付费→标记→取消流程，所有 Stripe Webhook 事件覆盖

---

#### M6：报告导出 + 上线准备

**目标：** PDF 报告可导出，平台公开上线

报告结构：
1. 平台 Logo + 查询时间戳 + 免责声明
2. 实体概览（基本信息 + 制裁状态 + 真实性评分）
3. 详细核查结果（注册信息 / 关联人员 / PSC 记录 / 用户标记摘要）
4. 数据来源清单（每条数据的来源 + 最后更新时间）
5. 查询用户信息 + 用途声明留白（供用户手填存档）

上线前检查清单：
- [ ] robots.txt 和 llms.txt 部署
- [ ] 所有实体页 JSON-LD 验证（Google Rich Results Test）
- [ ] GDPR 隐私政策 + Cookie 声明
- [ ] 用户标记免责条款 + 申诉流程文档
- [ ] Stripe 生产环境切换
- [ ] 速率限制（防止恶意批量查询）
- [ ] 错误监控（Sentry）
- [ ] 基础 Analytics（Plausible，隐私友好）

---

### Phase 1 精简技术栈

```
前端：  Next.js 14 + TypeScript + Shadcn/UI + Tailwind
后端：  Python 3.12 + FastAPI + SQLAlchemy
数据库：PostgreSQL 16（含 pg_trgm 扩展）
缓存：  Redis（查询缓存 + Celery broker）
队列：  Celery + Celery Beat（定时同步任务）
支付：  Stripe（含 Stripe Tax）
PDF：   WeasyPrint
邮件：  AWS SES
部署：  单台 EC2（t3.medium）+ RDS PostgreSQL + S3
CDN：   Cloudflare（免费套餐）
监控：  Sentry（免费套餐）
```

迁移触发条件（不要提前优化）：
- 搜索响应持续 > 500ms → 迁移 Elasticsearch
- 日查询 > 5,000 次 → 评估水平扩展
- 关系图谱查询 > 3 层 → 引入 Neo4j

---

### Phase 1 完成的定义

满足以下全部条件，才启动 Phase 2：

1. 有真实付费用户（非内部测试账号）
2. 月均查询次数 / 付费用户 > 10（验证刚需）
3. 免费 → 付费转化率 > 5%
4. 搜索准确率：已知案例人工抽测，召回率 > 80%
5. 系统可用性 > 99%（排除维护窗口）

---

## 十六、CEO 扩展评审决策（2026-04-04）

**评审模式：** SCOPE EXPANSION
**10x 愿景：** 从被动查询工具升级为主动风险情报网络，积累匿名交易信号，成为能源贸易合规的行业基础设施层。

### 已接受扩展

| # | 扩展内容 | 纳入阶段 | 理由 |
|---|---------|---------|------|
| 1 | 主动监控 + 每日风险摘要（Watchlist） | Phase 1 晚期 | 最强留存钩子，切换成本随列表增长 |
| 2 | 关联图谱可视化（Knowledge Graph） | Phase 2 | 差异化强，后端数据已有，仅需前端 |
| 3 | 浏览器插件（Browser Extension） | Phase 2 晚期/Phase 3 | 病毒式获客渠道 |
| 4 | AI 风险叙事（自然语言风险简报） | Phase 1 | 提升用户体验 + 强化 GEO |
| 5 | 港口风险气候概览（Port Risk Profiles） | Phase 2 | 内容营销 + GEO 双重价值 |
| 7 | 匿名社区情报（正向+负向双向） | Phase 2 | 唯一不可复制的数据资产 |

### 已跳过扩展

| # | 扩展内容 | 原因 |
|---|---------|------|
| 6 | 贸易融资银行 API（B2B2B 模式） | 用户跳过 |

### 修订后的分阶段路线

**Phase 1（更新）：** 核心查询引擎 + 主动监控 Watchlist + AI 风险叙事
**Phase 2（更新）：** 深度核查 + 关联图谱 + 港口概览 + 匿名社区情报 + 合同分析
**Phase 3（更新）：** 企业级生态 + 浏览器插件 + Q88验真 + 完整 UBO

---

## 十七、待讨论事项

- [ ] 数据模型设计（实体表结构、关联关系表）
- [ ] OpenSanctions 自托管 vs API 方案对比与选型
- [ ] Paris MOU / Tokyo MOU 按需抓取的具体实现
- [ ] 公司注册地风险分级标准（哪些司法区标记为高风险）
- [ ] 真实性评分的注册时间权重曲线设计
- [ ] 用户标记的人工审核工作流（冷启动阶段如何运营）
- [ ] 定价最终确认（需要市场调研）
- [ ] 种子客户获取策略
- [ ] Watchlist 监控的通知频率策略（实时/每日摘要/每周摘要）
- [ ] AI 风险叙事的语言策略（英文优先，是否支持中文/阿拉伯文版本）
- [ ] 匿名社区情报的防刷机制（如何防止竞争对手伪造正面评价）

---

## 十八、Section 4 数据流与交互边缘情况设计

### 总览

以下六个边缘情况均来自 CEO 评审 Section 4 识别的未定义场景。每个场景包含：数据模型、API 响应结构、UI/UX 流程、风险信号逻辑。

---

### 4.1 同名但不同公司的实体消歧（Disambiguation）

**场景描述：** 用户搜索 "Pacific Energy Trading"，系统在数据库中匹配到 3 个同名或高度相似的公司，注册于不同国家。系统不能自动选择，必须展示消歧页面让用户确认。

#### 数据模型

```sql
-- 实体主表（每个公司有唯一 entity_id）
CREATE TABLE entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name  TEXT NOT NULL,           -- 标准化名称
    entity_type     TEXT NOT NULL,           -- 'company' | 'vessel' | 'person' | 'terminal'
    registration_no TEXT,                    -- 注册号（可 NULL，如无注册信息）
    jurisdiction    TEXT,                    -- ISO 3166-1 国家代码
    registered_address TEXT,
    status          TEXT DEFAULT 'active',   -- 'active' | 'dissolved' | 'unknown'
    authenticity_score INTEGER,
    sanction_status TEXT DEFAULT 'not_listed', -- 'listed' | 'not_listed' | 'unknown'
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 实体别名表（用于多语言、曾用名、法律后缀变体）
CREATE TABLE entity_aliases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id   UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,
    alias_type  TEXT NOT NULL,  -- 'trade_name' | 'former_name' | 'transliteration' | 'legal_variant'
    language    TEXT,           -- ISO 639-1，如 'en' | 'ar' | 'zh'
    valid_from  DATE,
    valid_to    DATE,           -- NULL = 当前有效
    source      TEXT,           -- 来源（OpenSanctions / Companies House / 用户提交）
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 全文搜索索引（pg_trgm）
CREATE INDEX idx_entities_canonical_name_trgm
    ON entities USING gin(canonical_name gin_trgm_ops);
CREATE INDEX idx_entity_aliases_alias_trgm
    ON entity_aliases USING gin(alias gin_trgm_ops);
```

#### API 响应结构：消歧结果

```json
// GET /api/v1/search?q=Pacific+Energy+Trading&type=company
// HTTP 200 — 多结果时返回候选列表，而非单一实体
{
  "query": "Pacific Energy Trading",
  "result_type": "disambiguation_required",
  "candidates": [
    {
      "entity_id": "ent_abc123",
      "canonical_name": "Pacific Energy Trading Ltd",
      "jurisdiction": "GB",
      "jurisdiction_label": "United Kingdom",
      "registration_no": "12345678",
      "registered_address": "London, EC2V 8RF",
      "status": "active",
      "incorporated_date": "2018-03-15",
      "authenticity_score": 72,
      "sanction_status": "not_listed",
      "risk_level": "medium",
      "match_score": 0.97,         // pg_trgm 相似度
      "match_reason": "exact_name" // 'exact_name' | 'alias' | 'fuzzy'
    },
    {
      "entity_id": "ent_def456",
      "canonical_name": "Pacific Energy Trading FZE",
      "jurisdiction": "AE-FU",
      "jurisdiction_label": "Fujairah Free Zone, UAE",
      "registration_no": "FOIZ-2021-4471",
      "registered_address": "Fujairah, UAE",
      "status": "active",
      "incorporated_date": "2021-07-22",
      "authenticity_score": 41,
      "sanction_status": "not_listed",
      "risk_level": "high",
      "match_score": 0.91,
      "match_reason": "legal_variant"  // 法律后缀不同（FZE vs Ltd）
    },
    {
      "entity_id": "ent_ghi789",
      "canonical_name": "Pacific Energy Trading Pte Ltd",
      "jurisdiction": "SG",
      "jurisdiction_label": "Singapore",
      "registration_no": "202011234Z",
      "registered_address": "Singapore, 048583",
      "status": "dissolved",          // 已注销
      "incorporated_date": "2020-01-10",
      "dissolved_date": "2022-09-30",
      "authenticity_score": 55,
      "sanction_status": "not_listed",
      "risk_level": "medium",
      "match_score": 0.88,
      "match_reason": "fuzzy"
    }
  ],
  "total_candidates": 3,
  "search_time_ms": 47
}
```

#### UI/UX 流程

```
用户输入查询词
     │
     ▼
后端匹配（pg_trgm，去除法律后缀后比对）
     │
     ├── 唯一精确匹配（similarity > 0.95，仅 1 个结果）
     │        └──▶ 直接跳转到实体档案页
     │
     └── 多个候选（2+ 个，或最高相似度 < 0.95）
              └──▶ 展示消歧卡片列表
                       │
                       ▼
             ┌─────────────────────────────┐
             │  "找到 3 个匹配结果"         │
             │  ┌──────────────────────┐   │
             │  │ [GB] Pacific Energy  │   │
             │  │ Trading Ltd          │   │
             │  │ 评分: 72  ● 非制裁   │   │
             │  │ 成立: 2018  英国      │   │
             │  └──────────────────────┘   │
             │  ┌──────────────────────┐   │
             │  │ [AE] Pacific Energy  │   │
             │  │ Trading FZE  ⚠高风险 │   │
             │  │ 评分: 41  ● 非制裁   │   │
             │  │ 成立: 2021  富查伊拉   │   │
             │  └──────────────────────┘   │
             │  ┌──────────────────────┐   │
             │  │ [SG] Pacific Energy  │   │
             │  │ Trading Pte  ✗ 已注销│   │
             │  │ 评分: 55  ● 非制裁   │   │
             │  │ 成立: 2020  新加坡    │   │
             │  └──────────────────────┘   │
             │  "不在列表中？提交新实体"    │
             └─────────────────────────────┘
                       │
                 用户点击其中一张卡片
                       │
                       ▼
               跳转到对应实体档案页
               URL: /company/{slug}-{registration-number}
```

#### 风险信号

- 成立时间 < 2 年 + 富查伊拉/直布罗陀/马耳他注册 → 消歧页面自动标注 `⚠ 新注册高风险地区`
- 高相似度但注册号不同的两家公司同时存在 → 标注 `⚠ 可能存在冒名注册`

---

### 4.2 公司更名处理（Name Change History）

**场景描述：** "Hin Leong Trading"（2020年破产的新加坡油商）更名记录必须可追溯。用户搜索旧名需能找到当前实体；实体档案页展示完整更名历史。

#### 数据模型

```sql
-- 公司更名记录（entity_aliases 表的特化视图）
-- alias_type = 'former_name'，valid_to = 更名生效日期

-- 查询：旧名 → 找到当前实体
SELECT e.*, ea.alias AS searched_name, ea.valid_to AS renamed_at
FROM entities e
JOIN entity_aliases ea ON e.id = ea.entity_id
WHERE ea.alias % $1              -- pg_trgm 模糊匹配旧名
  AND ea.alias_type = 'former_name'
ORDER BY similarity(ea.alias, $1) DESC
LIMIT 5;
```

#### API 响应结构：包含更名历史的实体档案

```json
// GET /api/v1/entities/ent_abc123
{
  "entity_id": "ent_abc123",
  "canonical_name": "Hin Leong Trading (Pte) Ltd",   // 当前名称（即使已破产）
  "status": "dissolved",
  "name_history": [
    {
      "name": "Hin Leong Trading (Pte) Ltd",
      "valid_from": "1963-01-01",
      "valid_to": null,                              // null = 当前正式名
      "is_current": true
    },
    {
      "name": "Hin Leong & Co",
      "valid_from": null,
      "valid_to": "1990-05-01",
      "is_current": false,
      "source": "ACRA"
    }
  ],
  // ...其余字段
}
```

#### 搜索时的重定向逻辑

```
用户搜索旧名（如 "Hin Leong"）
     │
     ▼
系统在 entity_aliases 中命中 alias_type='former_name'
     │
     ▼
返回 HTTP 200，result_type = "name_redirect"

{
  "result_type": "name_redirect",
  "searched_name": "Hin Leong",
  "current_entity": { ...完整实体数据... },
  "redirect_notice": {
    "message": "该名称为历史曾用名，已更新至当前注册名称",
    "former_name": "Hin Leong",
    "current_name": "Hin Leong Trading (Pte) Ltd",
    "renamed_at": "1990-05-01"   // 可 null 如无精确日期
  }
}
```

#### UI 展示

```
实体档案页顶部展示 Banner（仅曾用名命中时）：
┌────────────────────────────────────────────────────────┐
│ ℹ 您搜索的 "Hin Leong" 是该公司的历史名称              │
│   当前注册名：Hin Leong Trading (Pte) Ltd               │
└────────────────────────────────────────────────────────┘

实体档案页内"公司名称历史"模块：
┌─────────────────────────────────────────────────────┐
│ 名称历史                                            │
│ ─────────────────────────────────────────────────  │
│ 2020-至今   Hin Leong Trading (Pte) Ltd  [当前]    │
│ 1963-1990   Hin Leong & Co                         │
│                              来源: ACRA BizFile     │
└─────────────────────────────────────────────────────┘
```

---

### 4.3 船舶转旗 / 更名 / 易主历史快照（Vessel State History）

**场景描述：** 船舶 IMO 号终身不变，但旗帜、船名、所有权、船级可能多次变更。制裁规避的常见手法是将制裁船舶转旗至巴拿马或帕劳，并改名。平台必须保留历史快照。

#### 数据模型

```sql
-- 船舶主表（以 IMO 号为稳定标识符）
CREATE TABLE vessels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imo_number      TEXT UNIQUE NOT NULL,       -- IMO 9位号，终身不变
    current_name    TEXT NOT NULL,
    vessel_type     TEXT,                       -- 'tanker' | 'bulk' | 'lng' | ...
    gross_tonnage   INTEGER,
    build_year      INTEGER,
    current_flag    TEXT,                       -- ISO 3166-1
    current_owner   TEXT,
    current_class   TEXT,                       -- 船级社 DNV / BV / LR / ...
    sanction_status TEXT DEFAULT 'not_listed',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 船舶历史快照表（每次状态变更记录一行）
CREATE TABLE vessel_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id       UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
    snapshot_date   DATE NOT NULL,              -- 变更生效日期
    field_changed   TEXT NOT NULL,              -- 'flag' | 'name' | 'owner' | 'class'
    old_value       TEXT,
    new_value       TEXT NOT NULL,
    source          TEXT NOT NULL,              -- 'IMO_GISIS' | 'MarineTraffic' | 'OpenSanctions'
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vessel_history_vessel_id ON vessel_history(vessel_id);
CREATE INDEX idx_vessel_history_snapshot_date ON vessel_history(snapshot_date DESC);
```

#### API 响应结构

```json
// GET /api/v1/vessels/imo/9387425
{
  "imo_number": "9387425",
  "current_name": "DARK HORIZON",
  "current_flag": "PA",
  "current_flag_label": "Panama",
  "current_owner": "Unknown LLC",
  "sanction_status": "listed",
  "sanction_programs": ["OFAC_SDN"],
  "risk_signals": [
    {
      "signal_type": "frequent_flag_change",
      "description": "过去 3 年内 3 次转旗",
      "severity": "high",
      "detail": "IR (2020) → VU (2021) → PA (2023)"
    },
    {
      "signal_type": "name_change_post_sanction",
      "description": "制裁后 47 天内改名",
      "severity": "critical",
      "detail": "原名 PACIFIC SPIRIT，制裁日 2022-11-14，改名日 2023-01-01"
    }
  ],
  "history": [
    {
      "snapshot_date": "2023-01-01",
      "field_changed": "name",
      "old_value": "PACIFIC SPIRIT",
      "new_value": "DARK HORIZON",
      "source": "IMO_GISIS"
    },
    {
      "snapshot_date": "2023-01-01",
      "field_changed": "flag",
      "old_value": "VU",
      "new_value": "PA",
      "source": "IMO_GISIS"
    },
    {
      "snapshot_date": "2021-03-15",
      "field_changed": "flag",
      "old_value": "IR",
      "new_value": "VU",
      "source": "IMO_GISIS"
    }
  ]
}
```

#### 自动风险信号规则

```python
# 在数据摄入管道中运行（Celery task）

RISK_SIGNALS = [
    {
        "id": "frequent_flag_change",
        "description": "频繁转旗",
        "severity": "high",
        "condition": lambda history: sum(
            1 for h in history
            if h.field_changed == 'flag'
            and h.snapshot_date >= date.today() - timedelta(days=365*3)
        ) >= 3
    },
    {
        "id": "name_change_post_sanction",
        "description": "制裁后改名",
        "severity": "critical",
        "condition": lambda vessel, history: (
            vessel.sanction_status == 'listed'
            and any(
                h.field_changed == 'name'
                and h.snapshot_date >= vessel.sanction_date
                and (h.snapshot_date - vessel.sanction_date).days <= 90
                for h in history
            )
        )
    },
    {
        "id": "flag_to_high_risk",
        "description": "转旗至高风险旗籍国",
        "severity": "medium",
        "HIGH_RISK_FLAGS": ["KP", "IR", "SY", "VU", "PW", "KM"],
        "condition": lambda history: any(
            h.field_changed == 'flag'
            and h.new_value in HIGH_RISK_FLAGS
            for h in history
        )
    }
]
```

#### UI 展示

```
船舶档案页"历史变更"时间线：

  2023-01-01  ● 改名: PACIFIC SPIRIT → DARK HORIZON  [IMO GISIS]
              ● 转旗: 瓦努阿图 → 巴拿马               [IMO GISIS]
              ⚠ CRITICAL: 制裁后 47 天内改名 + 转旗

  2022-11-14  🔴 OFAC SDN 制裁生效

  2021-03-15  ● 转旗: 伊朗 → 瓦努阿图                [IMO GISIS]
              ⚠ HIGH: 转旗至高风险旗籍国

  2020-01-01  📋 IMO GISIS 初始记录
```

---

### 4.4 用户提交风险标记后的待审状态展示

**场景描述：** 用户提交"付款违约"标记后，该标记需人工审核（冷启动期 24-72 小时）。提交方和其他查询用户在此期间看到的内容不同。

#### 数据模型

```sql
CREATE TABLE risk_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id       UUID NOT NULL REFERENCES entities(id),
    submitted_by    UUID NOT NULL REFERENCES users(id),
    flag_type       TEXT NOT NULL,  -- 'payment_default' | 'document_fraud' | 'identity_impersonation'
                                    -- | 'tank_fraud' | 'contract_fraud' | 'other_compliance'
    status          TEXT NOT NULL DEFAULT 'pending_review',
                                    -- 'pending_review' | 'approved' | 'rejected' | 'appealed'
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ,
    reviewed_by     UUID REFERENCES users(id),  -- 审核员 user_id
    rejection_reason TEXT,          -- 如被拒绝，填写原因
    appeal_deadline TIMESTAMPTZ,    -- 被标记方申诉截止日（审核通过后 30 天）
    -- 不存储提交方身份，只存 user_id 用于内部审计
    -- 公开展示时仅展示 flag_type 和 submitted_at（通过后）
    evidence_hash   TEXT,           -- 提交证据文件的 SHA-256 哈希（不存文件本身）
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_flags_entity_id ON risk_flags(entity_id);
CREATE INDEX idx_risk_flags_status ON risk_flags(status);
```

#### API 响应：提交方视角

```json
// POST /api/v1/flags  →  201 Created
{
  "flag_id": "flag_xyz999",
  "status": "pending_review",
  "submitted_at": "2026-04-04T10:30:00Z",
  "estimated_review_hours": 48,
  "message": "您的标记已收到，将在 48 小时内完成审核。审核通过后将向您发送邮件通知。"
}

// GET /api/v1/entities/ent_abc123  （提交方查询同一实体）
{
  "entity_id": "ent_abc123",
  // ...
  "risk_flags": {
    "approved_count": 0,
    "pending_count": 1,          // 提交方可见自己的待审标记
    "my_pending_flags": [
      {
        "flag_id": "flag_xyz999",
        "flag_type": "payment_default",
        "status": "pending_review",
        "submitted_at": "2026-04-04T10:30:00Z"
      }
    ]
  }
}
```

#### API 响应：其他用户视角（待审期间）

```json
// GET /api/v1/entities/ent_abc123  （其他用户）
{
  "entity_id": "ent_abc123",
  // ...
  "risk_flags": {
    "approved_count": 0,
    "pending_count": 0,   // 待审标记对其他用户不可见
    "flags": []           // 审核通过前不展示
  }
}
```

#### API 响应：审核通过后（所有用户）

```json
{
  "risk_flags": {
    "approved_count": 1,
    "flags": [
      {
        "flag_type": "payment_default",
        "flag_type_label": "付款违约",
        "status": "approved",
        "approved_at": "2026-04-06T14:20:00Z",
        "disclaimer": "此标记由平台验证用户提交，内容未经独立核实",
        "appeal_deadline": "2026-05-06T14:20:00Z"
      }
    ]
  }
}
```

#### UI 状态机

```
提交风险标记
     │
     ▼
┌─────────────────────────────────────┐
│  状态: 审核中                        │
│  ⏳ 您的标记正在等待人工审核          │
│  预计完成时间: 48 小时               │
│  审核通过后您将收到邮件通知            │
└─────────────────────────────────────┘
     │
     ├── 审核通过（→ approved）
     │        ▼
     │   实体页面展示橙色标记徽章
     │   "⚠ 1 条风险标记（未经独立核实）"
     │   被标记方可在 30 天内申诉
     │
     └── 审核驳回（→ rejected）
              ▼
         邮件通知提交方：驳回原因
         标记不公开展示，提交方可补充证据重新提交
```

---

### 4.5 Free 用户查询超额处理

**场景描述：** Free 用户每月 5 次免费查询额度用尽后，继续尝试查询时的体验设计。目标：清晰告知限制，同时最大化升级转化率。

#### 数据模型

```sql
CREATE TABLE user_query_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    period_start    DATE NOT NULL,     -- 计费周期开始（每月第一天）
    period_end      DATE NOT NULL,     -- 计费周期结束
    query_count     INTEGER DEFAULT 0,
    quota_limit     INTEGER NOT NULL,  -- Free=5 / Starter=100 / Pro=unlimited(-1)
    last_query_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, period_start)
);

-- 查询记录（用于审计和防止刷 refresh 重计）
CREATE TABLE query_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    entity_id   UUID REFERENCES entities(id),
    query_text  TEXT,
    result_type TEXT,   -- 'full' | 'limited' | 'blocked'
    queried_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### 后端配额检查逻辑

```python
async def check_query_quota(user_id: UUID, db: AsyncSession) -> QuotaCheckResult:
    """
    返回：
    - allowed: bool
    - remaining: int（-1 表示无限）
    - reset_date: date
    - upgrade_url: str（仅 blocked 时返回）
    """
    user = await get_user(user_id, db)
    if user.subscription_tier in ('starter', 'professional', 'enterprise'):
        return QuotaCheckResult(allowed=True, remaining=-1)

    period_start = date.today().replace(day=1)
    usage = await get_or_create_usage(user_id, period_start, db)

    remaining = max(0, FREE_TIER_LIMIT - usage.query_count)  # FREE_TIER_LIMIT = 5

    if remaining <= 0:
        return QuotaCheckResult(
            allowed=False,
            remaining=0,
            reset_date=next_month_first_day(),
            upgrade_url="/pricing"
        )

    # 允许查询，但提前预警
    return QuotaCheckResult(
        allowed=True,
        remaining=remaining,
        reset_date=next_month_first_day(),
        warn_low=(remaining <= 1)  # 最后 1 次时前端展示警告
    )
```

#### API 响应：超额时

```json
// GET /api/v1/search?q=Acme+Trading  （Free 用户，第 6 次查询）
// HTTP 402 Payment Required
{
  "error": "quota_exceeded",
  "message": "您本月的 5 次免费查询已用完",
  "quota": {
    "limit": 5,
    "used": 5,
    "remaining": 0,
    "reset_date": "2026-05-01",
    "days_until_reset": 27
  },
  "upgrade_options": [
    {
      "plan": "starter",
      "price_monthly": 99,
      "currency": "USD",
      "quota": 100,
      "cta": "立即升级，每月 100 次查询",
      "url": "/checkout/starter"
    },
    {
      "plan": "one_time_report",
      "price": 49,
      "currency": "USD",
      "cta": "单次购买此次完整报告 $49",
      "url": "/checkout/report?entity_id=ent_abc123"
    }
  ]
}
```

#### UI/UX 流程

```
Free 用户使用额度追踪（Header 显示）：
  本月剩余查询：3/5  ████░░  （用掉 2 次时）

最后 1 次查询时：
┌──────────────────────────────────────────────┐
│ ⚠ 这是您本月最后一次免费查询                  │
│   5月1日额度将重置                            │
│   [升级 Starter，每月 100 次查询]             │
└──────────────────────────────────────────────┘

超额后点击查询：
┌──────────────────────────────────────────────┐
│ 🔒 本月免费查询已用完                         │
│                                              │
│ 距下次重置还有 27 天（5月1日）                │
│                                              │
│ 继续查询的方式：                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Starter 计划   $99/月                    │ │
│ │ 每月 100 次查询 + 完整档案 + 1 席位      │ │
│ │             [立即升级]                    │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ 单次报告   $49                           │ │
│ │ 仅购买本次"Acme Trading Ltd"完整报告     │ │
│ │             [购买此次报告]               │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ 或等待下月额度重置（2026-05-01）             │
└──────────────────────────────────────────────┘
```

#### 防刷机制

- 相同实体重复查询（同一 `entity_id`）在 24 小时内**不重复计算配额**（命中缓存视为同一次查询）
- 超额响应返回实体的 `制裁状态（Listed/Not Listed）`，完整信息需付费，确保 Free 用户仍能判断是否值得购买

---

### 4.6 合同分析中提取到无法核实的实体

**场景描述：** LLM 从合同 PDF 中提取出公司名 "Eastern Petroleum Resources LLC"，但该公司在平台所有数据源（OpenSanctions、Companies House、OpenCorporates）中均无记录。如何展示，如何引导用户操作。

#### 处理管道

```
合同 PDF 上传
     │
     ▼
OCR（pdfplumber / AWS Textract / Claude Vision）
     │
     ▼
LLM 实体提取（公司名、IMO号、储罐名称、自然人）
     │
     ▼
对每个提取实体执行内部匹配（pg_trgm，相似度阈值 0.80）
     │
     ├── 命中（similarity >= 0.80）
     │        └──▶ 关联到已知实体，展示档案摘要 + 风险等级
     │
     └── 未命中（similarity < 0.80，或无结果）
              └──▶ 标记为 "unverified_entity"，触发专项展示逻辑
```

#### API 响应：含未核实实体的合同分析结果

```json
// POST /api/v1/contracts/analyze  →  200 OK
{
  "contract_id": "ctr_20260404_abc",
  "trade_form": "TTV",
  "extraction_confidence": 0.91,
  "entities": [
    {
      "extracted_name": "Petrogas International Ltd",
      "match_status": "verified",
      "matched_entity_id": "ent_def456",
      "matched_name": "Petrogas International Ltd",
      "match_confidence": 0.97,
      "risk_level": "medium",
      "sanction_status": "not_listed"
    },
    {
      "extracted_name": "Eastern Petroleum Resources LLC",
      "match_status": "unverified",     // 关键字段
      "matched_entity_id": null,
      "match_confidence": 0.0,
      "closest_match": {               // 最接近的候选（相似度不足阈值）
        "name": "Eastern Petroleum Corp",
        "similarity": 0.61,
        "jurisdiction": "BM",
        "note": "相似度不足，不自动关联"
      },
      "risk_signal": {
        "type": "unverifiable_counterparty",
        "severity": "high",
        "description": "合同中出现的公司在所有已知数据库中无记录"
      },
      "suggested_actions": [
        "manual_search",      // 用户手动在外部数据库搜索
        "request_docs",       // 向交易对手索要注册证明
        "submit_entity"       // 向平台提交该实体信息
      ]
    }
  ],
  "risk_flags": [
    {
      "type": "unverified_counterparty",
      "severity": "high",
      "affected_entity": "Eastern Petroleum Resources LLC",
      "message": "合同对方无可核实注册记录，建议在签约前要求提供注册文件"
    }
  ],
  "clause_risks": [ ... ]
}
```

#### UI 展示：未核实实体模块

```
合同分析结果页"实体核查"模块：

  ✅ Petrogas International Ltd
     匹配置信度: 97%  |  风险等级: 中  |  非制裁名单
     → 查看完整档案

  ❓ Eastern Petroleum Resources LLC   [未能核实]
  ┌─────────────────────────────────────────────────────┐
  │ ⚠ 无法在已知数据库中找到该公司记录                  │
  │                                                     │
  │ 此公司名称未出现于：                                │
  │   ✗ OpenSanctions（100+制裁名单）                   │
  │   ✗ Companies House（英国）                         │
  │   ✗ OpenCorporates（全球 130+ 国）                  │
  │                                                     │
  │ 最接近的已知实体：                                  │
  │   Eastern Petroleum Corp（百慕大）相似度 61%        │
  │   [查看该实体]                                      │
  │                                                     │
  │ 建议操作：                                          │
  │   [向交易对手索要注册证明]                          │
  │   [在外部数据库手动搜索]                            │
  │   [提交此实体至平台数据库]                          │
  └─────────────────────────────────────────────────────┘

风险摘要中自动包含：
  🔴 HIGH: 合同对方 "Eastern Petroleum Resources LLC" 无可核实注册记录
```

#### 未核实实体提交流程

```
用户点击"提交此实体至平台数据库"
     │
     ▼
弹出表单：
  - 实体名称（预填：Eastern Petroleum Resources LLC）
  - 注册国家/地区（必填）
  - 注册号（如有）
  - 官网 URL（如有）
  - 您与该实体的关系：○ 买方  ○ 卖方  ○ 中间商  ○ 其他
  - [上传注册证明文件（可选）]

     │
     ▼
平台内部标记为 "user_submitted_pending"
数据团队核实后提升为正式实体，或标记为"无法核实"
提交用户收到邮件通知核实结果
```

#### 风险信号说明

| 情况 | 风险信号 | 严重程度 |
|------|---------|---------|
| 合同对方完全无注册记录 | `unverifiable_counterparty` | HIGH |
| 合同对方注册时间 < 6 个月 | `newly_registered_counterparty` | MEDIUM |
| 合同对方与最接近已知实体相似度 60-80%（疑似仿冒） | `possible_impersonation` | HIGH |
| 合同中同一角色出现两个不同名称 | `name_inconsistency` | MEDIUM |

---

### 4.7 边缘情况数据流总览图

```
                        ┌─────────────────────────────┐
                        │        用户查询输入           │
                        └──────────────┬──────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │        pg_trgm 模糊匹配引擎           │
                    │  去除法律后缀 → 别名展开 → 评分排序   │
                    └──────┬─────────────────────┬─────────┘
                           │                     │
              ┌────────────▼──────┐   ┌──────────▼──────────┐
              │  唯一高置信度匹配  │   │  多候选 / 低置信度   │
              │  similarity>0.95  │   │  → 消歧页面（4.1）   │
              └────────────┬──────┘   └──────────────────────┘
                           │
              ┌────────────▼──────────────────────┐
              │          实体档案页                │
              │                                   │
              │  ┌─────────────────────────────┐  │
              │  │  曾用名命中？→ 更名Banner     │  │
              │  │  （4.2）                     │  │
              │  └─────────────────────────────┘  │
              │                                   │
              │  ┌─────────────────────────────┐  │
              │  │  船舶？→ 历史快照时间线       │  │
              │  │  （4.3）                     │  │
              │  └─────────────────────────────┘  │
              │                                   │
              │  ┌─────────────────────────────┐  │
              │  │  风险标记状态（4.4）          │  │
              │  │  pending → 仅提交方可见       │  │
              │  │  approved → 全用户可见        │  │
              │  └─────────────────────────────┘  │
              └───────────────────────────────────┘
                           │
              ┌────────────▼──────────────────────┐
              │         配额检查（4.5）            │
              │  Free: 计数 → 超额 → 402 + 升级引导 │
              │  Paid: 直接放行                    │
              └───────────────────────────────────┘

合同分析管道：
  PDF → OCR → LLM提取 → 实体匹配
                              │
                  ┌───────────┴────────────┐
                  │ 命中               未命中 │
                  │ → 关联档案        → 4.6  │
                  └────────────────────────┘
```

---

## 十七（更新）、待讨论事项

- [ ] 数据模型设计（已完成 Section 4 中的主要表结构，待细化索引策略）
- [ ] OpenSanctions 自托管 vs API 方案对比与选型
- [ ] Paris MOU / Tokyo MOU 按需抓取的具体实现
- [ ] 公司注册地风险分级标准（哪些司法区标记为高风险）
- [ ] 真实性评分的注册时间权重曲线设计
- [ ] 用户标记的人工审核工作流（冷启动阶段如何运营）
- [ ] 定价最终确认（需要市场调研）
- [ ] 种子客户获取策略
- [ ] Watchlist 监控的通知频率策略（实时/每日摘要/每周摘要）
- [ ] AI 风险叙事的语言策略（英文优先，是否支持中文/阿拉伯文版本）
- [ ] 匿名社区情报的防刷机制（如何防止竞争对手伪造正面评价）
- [ ] 消歧页面的 SEO/GEO 处理策略（disambiguation 页面是否需要独立 URL）
- [ ] 未核实实体提交后的数据团队核实 SLA（目标响应时间）

---

*文档持续更新，记录产品设计讨论*

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 10 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open (7/10) | score: 3/10 → 7/10, 4 decisions made |

**UNRESOLVED:** 0 decisions deferred (all 7 passes completed, all 4 decisions resolved)

**DESIGN DECISIONS MADE:**
- 移动端评分展示 → 水平进度条
- 空状态风格 → 图标+文字
- 界面语言 → i18n 支持 CN/EN 切换（Phase 1 起）
- 内容锁定层 → 展示 F2，模糊 F3

**VERDICT:** ENG CLEARED — ready to implement. Design review 7/10 (not blocking). Run `/design-review` after first HTML prototype to verify visual rendering.

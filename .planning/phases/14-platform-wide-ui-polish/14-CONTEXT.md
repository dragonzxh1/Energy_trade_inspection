# Phase 14: Platform-Wide UI Polish — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Source:** Phase 13 completion + user directive to apply same style to all remaining pages

<domain>
## Phase Boundary

将 Phase 13 确立的 micro-gradient 设计规范推广到 ETI 平台其余所有交互页面。Phase 13 已完成 `/trade` 页面的全量重写（Split Panel + TOKEN 常量 + micro-gradient controls）。Phase 14 将同一套视觉语言系统性地应用到：

1. `/screen` (`ScreenClient.tsx`) — 文件筛查页，最重要的工具页面，适合同款 Split Panel 改造
2. `/watchlist` (`watchlist/page.tsx`) — 实体监控列表，action 按钮样式升级
3. `/reports` (`ReportsClient.tsx`) — 报告历史页，GhostButton → secondary 按钮
4. `/` (`page.tsx` 首页) — CTA 按钮 + feature cards 样式升级
5. `/account` (`account/page.tsx`) — 账户设置，按钮 + quota 进度条升级

**不在本阶段范围：**
- Entity 详情页（`/company/[slug]`、`/vessel/[imo]`、`/terminal/[id]`）— 以展示为主，按钮较少，留后续专项处理
- Admin 页面 (`/admin`) — 内部工具，不对外展示
- Auth 页面（sign-in、sign-up、forgot/reset-password）— 不同 UX 场景

</domain>

<decisions>
## Implementation Decisions

### 设计规范来源（从 Phase 13 继承，已锁定）

所有控件规范直接沿用 Phase 13 建立的 TOKEN 常量体系，不重新发明：

**Primary Button（已锁定）：**
```
background: linear-gradient(180deg, #7578f2 0%, #5558e8 100%)
border: 1px solid rgba(99,102,241,0.45)
box-shadow: 0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)
border-radius: 7px; padding: 8px 16px; font-size: 13px; font-weight: 500
transition: all 0.12s ease
```
Hover: `linear-gradient(180deg, #818cf8, #6366f1)` + `transform: translateY(-1px)` + 更强 glow

**Secondary Button（已锁定）：**
```
background: #1e1e24; color: #8b8b9a
border: 1px solid rgba(255,255,255,0.07); border-radius: 7px
padding: 6px 14px; font-size: 13px
box-shadow: 0 1px 2px rgba(0,0,0,0.15); transition: all 0.12s ease
```
Hover: `background: #26262e; transform: translateY(-1px)`

**Input（已锁定）：**
```
background: rgba(0,0,0,0.28)
border: 1px solid rgba(255,255,255,0.07)
box-shadow: inset 0 2px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(0,0,0,0.12)
border-radius: 7px
```
Focus: `border-color: #6366f1; box-shadow: inset 0 2px 3px rgba(0,0,0,0.3), 0 0 0 2px rgba(99,102,241,0.18)`

**Progress Bar（已锁定）：**
```
track: height: 4px; background: rgba(0,0,0,0.35); border-radius: 2px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.4)
fill: background: #6366f1; transition: width 1.4s ease
```

**Section Label（已锁定）：**
```
font-size: 11px; color: #55556a; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 12px
```

**Surface Card（已锁定）：**
```
background: #111113; border: 1px solid rgba(255,255,255,0.07)
border-top-color: rgba(255,255,255,0.09); border-radius: 10px
box-shadow: 0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)
```

### TOKEN 常量复用策略

每个改造文件顶部定义同名 `TOKEN` 常量对象（与 TradeClient.tsx 保持一致），使用硬编码值而非 globals.css 变量。不修改 globals.css。

### /screen 页面（ScreenClient.tsx）— Split Panel 改造

- **布局：** Split Panel，左列 380px 固定（文件上传区 + 参数选项），右列弹性（Empty / Loading / Result 三态）
- **GlowLoader 替换：** 删除 GlowLoader import，改用 inline progress bar（与 TradeClient 相同的 1.4s 进度条动画）
- **上传区：** Drag & drop 区域使用 `#111113` 背景 + `rgba(255,255,255,0.07)` 虚线边框 + hover 时 `rgba(99,102,241,0.12)` 背景
- **Submit 按钮：** Primary micro-gradient 全宽按钮（"Screen Document →"）
- **右面板三态：** 空态（上传提示）/ Loading（进度条 + "Extracting parties…" 文案）/ Result（当前结果展示）

### /watchlist 页面（watchlist/page.tsx）

- **Action 按钮：** Refresh、Remove、Dismiss Alert 全部改为 secondary button 样式
- **状态 pill：** listed/not_listed/unknown 使用统一 pill 规范（rgba 背景 + border + 颜色文字）
- **表格行 hover：** `background: rgba(255,255,255,0.02)` 淡 hover 效果
- **不改结构：** Server Component 模式保持，仅升级视觉样式

### /reports 页面（ReportsClient.tsx）

- **GhostButton → secondary button：** Download、View 等操作按钮替换
- **列表行：** hover 背景 `#1e1e24`，风险 badge 使用 pill 规范
- **不加新功能**

### 首页 (`/` page.tsx)

- **CTA 按钮：** "Run trade check →"、"Screen a document →" 使用 primary micro-gradient
- **Feature cards：** 使用 score-card surface 规范（`#111113` + top-border highlight + border-radius 10px）
- **Trust stats：** 数字使用 `color: #6366f1`（brand color），与 Score Number 规范一致
- **Featured entities 卡片：** 保持当前结构，仅升级 border/surface/button 样式

### /account 页面（account/page.tsx）

- **Manage Billing 按钮：** Primary micro-gradient
- **Sign Out 等次要按钮：** Secondary button 样式
- **Quota 进度条：** 替换为 score progress bar 规范（4px track + indigo fill）
- **Plan badge：** 使用 pill 规范

### 改造顺序（推荐计划分拆）

- **14-01:** ScreenClient.tsx 全量重写（Split Panel + TOKEN + 进度条 + 三态面板）— 最复杂，独立 plan
- **14-02:** watchlist/page.tsx + ReportsClient.tsx 按钮/pill 样式升级
- **14-03:** 首页 page.tsx + account/page.tsx 样式升级 + 视觉验证 checkpoint

### Claude 自由裁量

- ScreenClient 左列具体布局（文件上传 drag zone 高度、选项排列方式）
- Loading 时进度条文案（"Extracting parties…" / "Screening entities…" 等步骤提示）
- 首页 hero section 是否增加细微 gradient 背景
- 响应式降级策略（ScreenClient Split Panel 在窄屏下的 stack 行为）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 13 设计规范（必读 — 所有控件规范的权威来源）
- `.planning/phases/13-trade-check-ui-redesign/13-CONTEXT.md` — TOKEN 常量体系、所有控件 CSS 规范、布局决策
- `.planning/phases/13-trade-check-ui-redesign/13-UI-SPEC.md` — 完整 UI 设计合同（Split Panel、Controls、三态面板）
- `src/app/trade/TradeClient.tsx` — Phase 13 实现参考（TOKEN 常量、primaryBtnBase、secondaryBtnStyle、inputStyleNew、panelState 状态机）

### Sketch 设计资产
- `.claude/skills/sketch-findings-Energy_trade_inspection/references/controls-and-tokens.md` — 按钮/输入框/Score/状态 pill 的精确 CSS 规范
- `.claude/skills/sketch-findings-Energy_trade_inspection/references/trade-check-layout.md` — Split Panel 结构参考

### 目标文件（改造前必须完整阅读）
- `src/app/screen/ScreenClient.tsx` (855 lines) — 当前筛查页实现
- `src/app/watchlist/page.tsx` (535 lines) — 当前监控列表实现
- `src/app/reports/ReportsClient.tsx` (484 lines) — 当前报告历史实现
- `src/app/page.tsx` (490 lines) — 当前首页实现
- `src/app/account/page.tsx` (237 lines) — 当前账户页实现

### 当前 Loading 组件（14-01 plan 需要替换的）
- `src/components/ui/GlowLoader.tsx` — ScreenClient 当前使用的 loader（替换为 inline progress bar 后不再引用）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Patterns（从 Phase 13 已验证）
- `TOKEN` 常量对象模式：在每个改造文件顶部集中声明所有颜色/尺寸值，使用硬编码而非 CSS 变量
- `panelState` 状态机：`'empty' | 'loading' | 'result' | 'error'` — ScreenClient 可直接复用该模式
- `primaryBtnBase` / `primaryBtnHover` / `secondaryBtnStyle` — 从 TradeClient.tsx 直接复制结构
- Progress bar 动画：`setTimeout(() => setProgress(100), 50)` + `transition: 'width 1.4s ease'`

### 各页面当前状态
- **ScreenClient.tsx：** 使用 GlowLoader（需替换），单列布局（需改 Split Panel），buttons 无 micro-gradient
- **watchlist/page.tsx：** Server Component，使用 `var(--bg-surface)` CSS 变量风格 inline style，按钮样式陈旧
- **ReportsClient.tsx：** 有 GhostButton 内部组件（需替换为 secondary btn），`'use client'`
- **page.tsx：** Server Component，CTA `<a>` 标签作按钮使用，feature cards 用 `var(--bg-surface)`
- **account/page.tsx：** Server Component + `<form>` action，quota 进度条用简单 div width

### Integration Points
- ScreenClient Split Panel：`<main>` 容器改为无 maxWidth（参考 Phase 13 trade/page.tsx 修改方式）
- screen/page.tsx：检查 `<main>` 容器是否有 maxWidth 约束，若有则移除（与 trade/page.tsx 相同处理）

</code_context>

<specifics>
## Specific Ideas

- **ScreenClient Split Panel 比例：** 左列文件上传区建议 420px（比 TradeClient 的 380px 稍宽，因为 drag zone 需要更多空间），右列弹性
- **Drag & drop 上传区高度：** 建议 160–200px，内有上传图标 + "Drop file here or click to browse" 文案
- **ScreenClient Loading 步骤文案：** "Uploading…" → "Extracting parties…" → "Screening entities…" — 与进度条动画配合
- **首页 CTA 按钮：** 两个工具入口（Trade Check、Screen Document）并排或分卡片展示，各用 primary btn

</specifics>

<deferred>
## Deferred Ideas

- Entity 详情页（company/vessel/terminal）按钮升级 — 展示页面，按钮较少，可在后续专项阶段处理
- Light theme 全局启用 — sketch 已验证 light.css，但本阶段仅做 dark theme 统一
- ScreenClient 移动端响应式完整适配 — 合规用户桌面为主，简单 stack 降级即可
- Admin 页面视觉升级 — 内部工具，优先级低

</deferred>

---

*Phase: 14-platform-wide-ui-polish*
*Context gathered: 2026-04-19*

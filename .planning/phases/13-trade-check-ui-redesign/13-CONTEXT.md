# Phase 13: Trade Check UI Redesign — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Source:** Sketch Wrap-Up (sketch sessions 001-controls-quality, 002-trade-check-form)

<domain>
## Phase Boundary

将 `/trade` 页面的 `TradeClient.tsx` 从当前单列布局（max-width 760px）升级为 sketch 验证的 Split Panel 布局（380px 固定左列 + 弹性右列），同时应用 micro-gradient 控件规范。不触碰后端 API（`/api/trade`）、评分逻辑、或其他页面组件。

本阶段纯粹是 UI 层改动：布局重构 + 控件样式升级 + 三态右面板实现 + Recent Checks 历史记录。

</domain>

<decisions>
## Implementation Decisions

### 布局

- **Split Panel 布局（已锁定）**：`display: grid; grid-template-columns: 380px 1fr; min-height: calc(100vh - 44px)`（44px 为 Header 高度）
- 左列：`border-right: 1px solid var(--color-border); padding: var(--space-8) var(--space-6); overflow-y: auto; background: var(--color-surface)`
- 右列：`padding: var(--space-8); overflow-y: auto`
- 全宽布局：Trade page 的 `<main>` 容器移除 `maxWidth: 'var(--max-width)'`，改为全宽，让 split panel 填满视口

### CSS 变量映射

sketch 使用 `--color-*` 变量，当前 globals.css 使用 `--bg-*` / `--accent-*`。方案：在 TradeClient.tsx 顶部通过 `:root` 或 CSS 模块添加适配器变量，映射如下：

| Sketch 变量 | 现有变量 | 值 |
|------------|---------|-----|
| `--color-surface` | `--bg-surface` | `#111113` |
| `--color-elevated` | `--bg-elevated` | `#1e1e24` |
| `--color-elevated-2` | `--bg-subtle` | `#26262e` |
| `--color-border` | `--border-default` | `rgba(255,255,255,0.07)` |
| `--color-border-hover` | `--border-subtle` | `rgba(255,255,255,0.14)` |
| `--color-primary` | `--accent-primary` | `#6366f1` |
| `--color-text` | `--text-primary` | `#f1f1f3` |
| `--color-text-muted` | `--text-muted` | `#8b8b9a` |
| `--color-text-subtle` | `--text-faint` | `#55556a` |

**决定：** 不改 globals.css，在 `TradeClient.tsx` 内联 style 中直接使用硬编码值（与 sketch CSS 保持一致），并在文件顶部的 `TOKEN` 常量对象中集中管理。

### Primary Button（已锁定）

```css
background: linear-gradient(180deg, #7578f2 0%, #5558e8 100%);
color: #fff;
border: 1px solid rgba(99,102,241,0.45);
box-shadow: 0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25);
border-radius: 7px;
padding: 8px 16px;
font-size: 13px; font-weight: 500;
transition: all 0.12s ease;
```
Hover: `linear-gradient(180deg, #818cf8, #6366f1)` + `transform: translateY(-1px)` + stronger glow

"Run Trade Check →" 按钮全宽（`width: 100%`），padding 11px 0。

### Secondary Buttons（Watch trade, Export PDF, New check）

```css
background: var(--bg-elevated);  /* #1e1e24 */
color: var(--text-muted);
border: 1px solid rgba(255,255,255,0.07);
border-radius: 7px;
padding: 6px 14px; font-size: 13px;
box-shadow: 0 1px 2px rgba(0,0,0,0.15);
transition: all 0.12s ease;
```
Hover: `background: #26262e; transform: translateY(-1px)`

### Inputs（已锁定）

```css
background: rgba(0,0,0,0.28);
border: 1px solid rgba(255,255,255,0.07);
box-shadow: inset 0 2px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(0,0,0,0.12);
border-radius: 7px;
color: #f1f1f3;
font-size: 13px;
padding: 8px 12px;
```
Focus：`border-color: #6366f1; box-shadow: inset 0 2px 3px rgba(0,0,0,0.3), 0 0 0 2px rgba(99,102,241,0.18);`

通过 `onFocus`/`onBlur` state 动态切换 style（避免 CSS class 冲突）。

### 右面板三态（已锁定）

| 状态 | 内容 |
|------|------|
| Empty | 居中 icon + "Run a trade check to see results" 提示文本 |
| Loading | 进度条动画（width 0% → 100%，1.4s ease）+ "Screening trade..." 文本，**替代** GlowLoader |
| Result | 现有 ResultBanner + FlagCards + PartyCards 内容 |

Loading 进度条（替代 GlowLoader）：
```html
<div style="width:200px;height:3px;background:rgba(0,0,0,0.35);border-radius:2px;overflow:hidden">
  <div id="progress-bar" style="height:100%;background:#6366f1;width:0%;transition:width 1.4s ease"></div>
</div>
```
setTimeout 50ms 后触发 width: 100%（让 transition 生效）。

### Recent Checks（已锁定）

- 存储：`localStorage`，key `eti_recent_trade_checks`，存最近 5 条
- 每条包含：`{ seller, vessel?, commodity?, loadingPort?, overallRisk, checkedAt }` （checkedAt: ISO string）
- 显示在表单下方，标题 "Recent Checks"（uppercase caps style）
- 每行点击：`window.location.href = '/trade?seller=...&vessel=...'` 预填表单
- 首次运行成功后，将 `{ seller, vessel, commodity, loadingPort, overallRisk, checkedAt }` 推入 localStorage

### Form 布局调整

- 从 2 列 grid 改为单列（左面板 380px 已够窄，2 列 grid 太挤）
- 字段顺序：Seller * → Vessel Name → IMO Number → Trade Date → Loading Port → Commodity → Seller Domain
- Labels 使用 uppercase caps 风格（`text-transform: uppercase; letter-spacing: 0.07em; font-size: 11px`）

### 响应式降级（Claude 自由裁量）

- 当视口 < 768px 时，stack 为单列（左面板在上，右面板在下）
- 使用内联 media query 或直接设定不响应（合规用户通常桌面使用）

### UpgradePrompt 保持不变

不修改 `page.tsx` 中的 `UpgradePrompt` 组件（功能性内容，不在本阶段 scope 内）。

### Claude 自由裁量

- 右面板 Empty state 具体图标/文案细节
- Loading 时显示的步骤文案（如果需要保留 STEPS 数组的话）
- Recent Checks 每行是否显示 risk badge

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Sketch 设计合同
- `.claude/skills/sketch-findings-Energy_trade_inspection/SKILL.md` — 整体设计方向、Reference points、主题
- `.claude/skills/sketch-findings-Energy_trade_inspection/references/controls-and-tokens.md` — 按钮/输入框/Score/状态 pill 的精确 CSS 规范
- `.claude/skills/sketch-findings-Energy_trade_inspection/references/trade-check-layout.md` — Split Panel 结构、三态面板、Recent Checks HTML 模式

### 当前实现（必须读懂再修改）
- `src/app/trade/TradeClient.tsx` — 当前 Trade Check 主组件（760 行，全部内联 style）
- `src/app/trade/page.tsx` — Server 组件，auth 门控，`<main>` 容器 padding
- `src/styles/globals.css` — 现有 CSS 变量命名空间
- `src/components/ui/GlowLoader.tsx` — 当前 loading 组件（将被 inline 进度条替代）

### 类型合同（不得修改）
- `src/app/api/trade/route.ts` — `TradeCheckResult`、`TradePartyResult`、`TradeVesselResult`、`TradePortResult` 类型定义
- `src/lib/server/trade-rules.ts` — `TradeFlag`、`TradeVerdict`、`FLAG_EXPLANATIONS` 类型

</canonical_refs>

<specifics>
## Specific Ideas

### Split Panel 外壳（来自 sketch）

```html
<div style="display:grid;grid-template-columns:380px 1fr;min-height:calc(100vh - 44px)">
  <!-- LEFT: 表单 + Recent Checks -->
  <div style="border-right:1px solid rgba(255,255,255,0.07);padding:32px 24px;overflow-y:auto;background:#111113">
    ...
  </div>
  <!-- RIGHT: Empty / Loading / Result -->
  <div style="padding:32px;overflow-y:auto">
    ...
  </div>
</div>
```

### Section Label 样式

```css
font-size: 11px; color: #55556a;
text-transform: uppercase; letter-spacing: 0.07em;
margin-bottom: 12px;
```

### Recent Checks 列表项

```html
<div class="recent-item" style="padding:8px 10px;border-radius:7px;cursor:pointer">
  <div style="font-size:13px;font-weight:500">Vitol SA</div>
  <div style="font-size:11px;color:#8b8b9a">Crude Oil · Primorsk · <span style="color:#4ade80">Low</span></div>
</div>
```

</specifics>

<deferred>
## Deferred Ideas

- Light theme（`sources/themes/light.css`）：本阶段仅实现 dark theme，light theme 留给 PDF/报告场景
- Score 0–100 数字展示：Trade Check 当前不返回数字分数，Authenticity Score 只在实体详情页展示
- 移动端完整响应式：合规用户主要桌面使用，简单降级即可

</deferred>

---

*Phase: 13-trade-check-ui-redesign*
*Context gathered: 2026-04-19 via Sketch Wrap-Up findings*

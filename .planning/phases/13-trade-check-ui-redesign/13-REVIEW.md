---
phase: 13-trade-check-ui-redesign
reviewed: 2026-04-19T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/app/trade/TradeClient.tsx
  - src/app/trade/page.tsx
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-04-19
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

两个文件共同实现了 Trade Check 的分屏 UI（左侧表单 + 右侧结果面板）。整体结构清晰，身份验证和方案门控在服务端正确处理，类型引用与 API 层一致。

发现 4 个警告级问题，主要集中在：(1) `callbackUrl` 重定向链中仅当两个参数都存在时才保留参数，导致单参数场景下表单预填数据丢失；(2) localStorage 解析结果未做类型验证，可能在存储损坏时崩溃；(3) `LoadingView` 进度条在 loading 取消（组件卸载）后仍有 DOM 操作；(4) `ResultBanner` 直接访问 `result.vessel` 不做空值保护，但当前类型定义要求该字段必存在，若 API 将来改变会静默崩溃。另有 3 个信息级问题。

---

## Warnings

### WR-01: 登录重定向仅在 seller 和 vessel 同时存在时才保留两者

**File:** `src/app/trade/page.tsx:34-36`

**Issue:** `callbackUrl` 的构建逻辑使用 `seller && vessel` 作为条件，导致只有当两个字段都有值时才将查询参数带入回调 URL。若用户仅携带 `?seller=X` 访问 `/trade`，重定向到登录页后 `callbackUrl` 变成 `/trade`，表单预填值丢失。

```ts
// 当前
const tradeUrl = seller && vessel
  ? `/trade?seller=${encodeURIComponent(seller)}&vessel=${encodeURIComponent(vessel)}`
  : '/trade'
```

**Fix:** 分别检查两个字段，仅拼接非空参数：

```ts
const qs = new URLSearchParams()
if (seller) qs.set('seller', seller)
if (vessel) qs.set('vessel', vessel)
const tradeUrl = `/trade${qs.toString() ? '?' + qs.toString() : ''}`
```

---

### WR-02: localStorage 数据未做结构验证，类型断言掩盖损坏数据

**File:** `src/app/trade/TradeClient.tsx:117-119`

**Issue:** `getRecent()` 将 `JSON.parse` 的返回值直接 `as RecentCheck[]` 强制转型。若 localStorage 中存有格式不符的旧数据（如早期版本写入的结构），后续代码访问 `r.overallRisk` 并将其传入 `RISK_COLOR[r.overallRisk]` 会得到 `undefined`，导致样式计算静默失败或在运行时 map 查找中抛出。

```ts
// 当前 — 无结构保护
return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as RecentCheck[]
```

**Fix:** 在返回前过滤非法条目：

```ts
function isRecentCheck(v: unknown): v is RecentCheck {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.seller === 'string' &&
    ['critical','high','medium','low'].includes(o.overallRisk as string) &&
    typeof o.checkedAt === 'string'
}

function getRecent(): RecentCheck[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isRecentCheck) : []
  } catch { return [] }
}
```

---

### WR-03: LoadingView 在组件卸载后仍操作 DOM

**File:** `src/app/trade/TradeClient.tsx:342-347`

**Issue:** `LoadingView` 的 `useEffect` 创建 50ms 定时器后，若 API 返回极快（<50ms）导致 loading 状态立即离开，组件卸载时 cleanup 函数会清除 timer，但 `barRef.current` 的引用仍然存在（React 不保证 ref 在 cleanup 之前为 null）。此处 `clearTimeout` 的 cleanup 仅防止了 `setTimeout` 回调在卸载后调用，功能上正确，但 ref 模式中存在一个更隐蔽的竞争：若 timer 在 unmount 之前触发、而 cleanup 在触发后才运行，style 赋值仍会执行在已卸载的 DOM 节点上（React 不会阻止这种操作，只是无意义地设置 style）。

更严重的是：若 `barRef.current` 在 timer 回调触发时为 `null`（极端情况），代码已正确使用 `if (barRef.current)` 检查，所以不会崩溃。实际问题是 cleanup 逻辑的顺序可能不能保证——当前代码实际上是安全的，但依赖了 React 卸载的时序假设。

真正的潜在问题：`LoadingView` 的 `panelState === 'loading' && lastInput &&` 条件检查中，`lastInput` 在 `submit()` 的第一行被 `setInput(v)` 设置，而 `setPanelState('loading')` 在第二行才设置。由于 React 18 的批处理，两次 setState 会在同一个渲染周期内合并，所以实际不会出现 `panelState === 'loading' && !lastInput` 的中间态。但这一隐含依赖在未来若代码分离会引发 bug。

**Fix:** 将两个状态更新合并为一次（或通过 reducer 保证原子性），使逻辑意图显式化：

```ts
// 在 submit() 开头
setInput(v)
setPanelState('loading')
// 可改为
setPanelState('loading')  // 已足够，lastInput 在同一批次里设置
```

此问题严重性为 Warning 而非 Critical，因为当前 React 18 的批处理确实保证了两个 setState 同批执行，无运行时错误。但属于隐含时序耦合，值得记录。

---

### WR-04: `result.vessel` 在 `ResultBanner` 中无保护地访问，依赖 API 类型约束

**File:** `src/app/trade/TradeClient.tsx:681`

**Issue:** `ResultBanner` 渲染时直接访问 `result.vessel.imo`，而 `result.vessel` 在 `TradeCheckResult` 接口中是必需字段（非 optional）。这意味着若 API 将来返回缺少 `vessel` 字段的响应（如接口演进或网络截断），`result.vessel` 为 `undefined` 时会在 JSX 渲染中抛出 TypeError，页面整体崩溃。

当前类型安全，但位于 JSON 反序列化边界（`json as TradeCheckResult`，第 895 行），无运行时 schema 验证。

```ts
// 第 895 行的强制类型断言
const tradeResult = json as TradeCheckResult
```

**Fix:** 在 `ResultBanner` 中添加防御性检查，或对 `vessel` 字段的 `imo` 使用可选链：

```ts
{result.vessel?.imo ? ` (IMO ${result.vessel.imo})` : ''}
```

---

## Info

### IN-01: `GlowLoader` 导入保留但从未使用

**File:** `src/app/trade/TradeClient.tsx:11`

**Issue:** 第 11 行导入了 `GlowLoader`，注释说明其已被内联进度条替代，但导入本身未被删除。这是一个未清理的死代码，会增加打包依赖并在 lint 中产生 `no-unused-vars` 警告（若开启了该规则）。

**Fix:** 删除第 11 行的 import 语句。

---

### IN-02: `secondaryBtnStyle` 对象在每次渲染时重新创建

**File:** `src/app/trade/TradeClient.tsx:87-100`

**Issue:** `secondaryBtnStyle` 定义为模块级常量，这是正确的。但 `SaveTradeWatchButton` 在 hover 状态分支中使用了展开运算符 `{ ...secondaryBtnStyle, ... }`，会在每次渲染时创建新对象。此为轻微 info 项，对性能几乎无影响，记录以便知悉。

**Fix:** 可将 hover 覆盖样式也提取为模块级常量，避免每次渲染分配（可选优化）。

---

### IN-03: `UpgradePrompt` 中有多余的缩进不一致

**File:** `src/app/trade/page.tsx:70-107`

**Issue:** `UpgradePrompt` 函数内部的 JSX 使用了混合缩进（部分使用 6 空格前置 + 额外缩进，行 70、79-80、106-107），与文件其余部分的 2 空格风格不一致。不影响功能，但与项目代码风格不符。

**Fix:** 对齐为标准 2 空格缩进（由格式化工具自动处理即可）。

---

_Reviewed: 2026-04-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

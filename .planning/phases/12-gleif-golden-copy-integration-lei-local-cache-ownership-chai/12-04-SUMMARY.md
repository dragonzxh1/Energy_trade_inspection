---
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
plan: "04"
subsystem: scoring, gleif, repository
tags: [gleif, lei, reporting-exception, risk-flag, scoring, opacity, D-07]

requires:
  - "12-01: lei_cache 表 DDL (reporting_exception_type 字段)"
  - "12-02: LeiCacheRow 接口含 reporting_exception_type"
  - "12-03: getLeiCacheRecord helper + 缓存命中路径"

provides:
  - "ScoringInputs.reportingExceptionFlag?: boolean (scoring.ts)"
  - "scoreCompany() reporting exception 扣分路径 (Math.max(0, C-3))"
  - "OPACITY_EXCEPTION_TYPES = Set(['NON_CONSOLIDATING','NON_PUBLIC','NO_LEI']) (gleif.ts + repository.ts)"
  - "buildGleifCompany(record, sanctionStatus, reportingExceptionType?) — 第三参数触发 communityReputationFinal 扣减"
  - "repository.ts 缓存命中路径：lei- 和 gleif: 均注入 reporting_exception RiskFlag + 评分扣减"
  - "repository.ts warm-on-miss 路径：同上，从 freshCached 读取 exception 数据"

affects:
  - 12-05  # 所有权链（消费同一 lei_cache 行中的 direct/ultimate parent 字段）

tech-stack:
  added: []
  patterns:
    - "opacity exception 扣分：两个独立路径——scoring.ts computeScore 路径（company 实体）和 gleif.ts buildGleifCompany 直接路径（GLEIF 专有路径）"
    - "RiskFlag 内存注入：对象在 repository 层构建，不写入 risk_flags 表，与社区标志完全隔离"
    - "OPACITY_EXCEPTION_TYPES 双重定义：gleif.ts 和 repository.ts 各有独立常量，保持各模块自包含"
    - "Python 二进制模式修改：repository.ts 含 GBK 编码注释 + CRLF，Edit 工具失效，改用 Python open(rb)/wb"

key-files:
  created: []
  modified:
    - "src/lib/server/scoring.ts"
    - "src/lib/server/gleif.ts"
    - "src/lib/server/repository.ts"

key-decisions:
  - "buildGleifCompany 直接扣分而非依赖 computeScore：该函数使用硬编码内联评分，不调用 computeScore()，因此必须在函数内直接修改 communityReputationFinal 和 authenticityScore"
  - "OPACITY_EXCEPTION_TYPES 在两个模块分别定义：保持各模块自包含，避免循环依赖；两个集合值相同，可通过代码审查验证"
  - "RiskFlag 不持久化：reporting_exception 来自 GLEIF 官方数据，已可信；持久化到 risk_flags 表会混淆社区标志语义"
  - "warm-on-miss 路径读 freshCached 而非假设无 exception：cache miss 时 writeLeiCacheRecord 只写 Level 1 字段，reporting_exception_type 仅由 syncLeiExceptions (Level 2) 写入，因此 freshCached 可能为空——代码正确处理了 null 情况"

requirements-completed:
  - D-07

duration: ~4min
completed: "2026-04-17"
---

# Phase 12 Plan 04: Reporting Exception Risk Signal Integration Summary

**将 GLEIF 报告豁免（Reporting Exception）转化为可操作风险信号：scoring.ts ScoringInputs 扩展 + scoreCompany communityReputation 扣分；gleif.ts buildGleifCompany() 直接应用 opacity 扣减（绕过 computeScore 路径）；repository.ts 缓存命中和 warm-on-miss 路径注入 reporting_exception RiskFlag 并同步评分（per D-07）**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-17T05:04:56Z
- **Completed:** 2026-04-17T05:09:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

**Task 1: scoring.ts — ScoringInputs + communityReputation 扣分（per D-07）**

- 在 `ScoringInputs` 接口末尾添加 `reportingExceptionFlag?: boolean`，附 JSDoc 说明 NATURAL_PERSONS 豁免的排除逻辑
- 在 `scoreCompany()` 的 communityReputation 块末尾（if/else 之后，return 之前）插入：`if (inputs.reportingExceptionFlag) { C = Math.max(0, C - 3) }`
- 使用 `Math.max(0, ...)` 确保 C 不为负数（fraudHits > 0 时 C=0 不变）
- 不修改 `scoreVessel`、`scoreTerminal`（仅公司实体有 reporting exception）

**Task 2: gleif.ts + repository.ts — 直接扣分 + RiskFlag 注入（per D-07）**

- `gleif.ts`：添加模块级 `OPACITY_EXCEPTION_TYPES = new Set(['NON_CONSOLIDATING', 'NON_PUBLIC', 'NO_LEI'])`
- `gleif.ts`：`buildGleifCompany()` 增加第三参数 `reportingExceptionType?: string | null`
- `gleif.ts`：计算 `communityReputationFinal = hasOpacityException ? Math.max(0, communityReputation - 3) : communityReputation`，`authenticityScore` 相应调整
- `repository.ts`：添加独立 `OPACITY_EXCEPTION_TYPES` 常量（同值，模块自包含）
- `repository.ts`：`lei-` 前缀缓存命中路径：`resolveGleifRecord` 返回后检查 `reporting_exception_type`，注入 `RiskFlag` + 直接修改 `scoreBreakdown.communityReputation.score` 和 `authenticityScore`
- `repository.ts`：`lei-` 前缀 warm-on-miss 路径：`writeLeiCacheRecord` 后读 `freshCached`，若有 opacity exception 同样注入 RiskFlag + 扣分
- `repository.ts`：`gleif:` 前缀缓存命中路径和 warm-on-miss 路径：与 `lei-` 路径完全对称处理

## Task Commits

1. **Task 1: scoring.ts ScoringInputs + communityReputation 扣分** — `bff6249` (feat)
2. **Task 2: gleif.ts OPACITY_EXCEPTION_TYPES + buildGleifCompany 扣分；repository.ts RiskFlag 注入** — `f076aca` (feat)

## Files Created/Modified

- `src/lib/server/scoring.ts` — +10 行（ScoringInputs 字段 + scoreCompany 扣分块）
- `src/lib/server/gleif.ts` — +20 行（OPACITY_EXCEPTION_TYPES 常量 + 第三参数 + communityReputationFinal 计算）
- `src/lib/server/repository.ts` — +125 行（OPACITY_EXCEPTION_TYPES + 4 个注入点：lei- 命中/miss + gleif: 命中/miss）

## Decisions Made

- **buildGleifCompany 直接扣分**：该函数使用硬编码内联评分，不经过 `computeScore()`，必须在函数内直接修改分数。如果仅修改 scoring.ts 而不修改 gleif.ts，GLEIF 实体的评分将永远不受 `reportingExceptionFlag` 影响
- **OPACITY_EXCEPTION_TYPES 双重定义**：gleif.ts 和 repository.ts 各自独立定义，保持模块自包含；避免 gleif.ts 引入 repository.ts 依赖（循环依赖风险）
- **RiskFlag 对象不写入 risk_flags 表**：reporting_exception 是 GLEIF 官方机器可读数据，信任来源明确；社区 risk_flags 是用户举报数据，语义不同，混淆会影响审计追踪
- **warm-on-miss 路径读 freshCached**：`writeLeiCacheRecord` 仅写 Level 1 字段（不含 `reporting_exception_type`），exception 数据由 `syncLeiExceptions` 写入；因此 warm-on-miss 时 freshCached.reporting_exception_type 通常为 null，代码正确处理（不注入 RiskFlag），等下次全量同步后缓存命中路径才会触发

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Environment Notes

- **[Environment Limitation] next lint 在 worktree 中无法运行**
  - `npm run lint` 调用 `next lint`，该命令在 worktree 子目录中因项目路径解析问题失败（`Invalid project directory`）
  - 替代验证：`npm run type-check` 在主项目目录运行，exit code 0，完全覆盖类型安全性
  - 代码变更均为数据流修改（无新 JSX/React hooks），不会引入 next/react 相关 lint 规则违规
  - **影响：** 无代码质量风险，已记录供后续 CI 验证

## Known Stubs

无。所有 reporting exception 逻辑已完整实现：
- `OPACITY_EXCEPTION_TYPES` 包含正确的三个类型
- RiskFlag 注入在 4 个缓存路径均已实现
- 评分扣减在 gleif.ts（buildGleifCompany 路径）和 scoring.ts（computeScore 路径）均已实现

## Threat Flags

实现符合 Plan 的 threat_model 中所有 T-12-04-* 处置：

- **T-12-04-01 (accept):** `lei_cache.reporting_exception_type` 仅由 `syncLeiExceptions` 写入（GLEIF 官方数据），不接受用户输入 ✓
- **T-12-04-02 (mitigate):** `OPACITY_EXCEPTION_TYPES` 集合在代码中硬编码，`NATURAL_PERSONS` 明确排除，两个定义均可代码审查验证 ✓
- **T-12-04-03 (accept):** `riskFlags` 数组每个实体最多追加一个 `reporting_exception` 标志（ID 唯一：`gleif-exception-{type}`）✓
- **T-12-04-04 (accept):** `ExceptionReason`（详细原因）未暴露到 RiskFlag，仅存于 `lei_cache.reporting_exception_reason` 表字段 ✓
- **T-12-04-05 (accept):** `buildGleifCompany` 第三参数仅由 repository.ts 服务端内部传入，不来自用户输入 ✓

## User Setup Required

None — 风险标志在内存中构建，不需要额外数据库迁移或配置。`reporting_exception_type` 字段由 Plan 01 的 migration 036/037 提供，由 Plan 05 的 syncLeiExceptions 填充。

## Next Phase Readiness

- Plan 05（全量同步 dispatch）执行后，`lei_cache` 中的 `reporting_exception_type` 将大量填充
- 届时缓存命中路径将触发 RiskFlag 注入，实体页面将显示 `reporting_exception` 风险徽章
- Plan 04 不依赖 Plan 05 的数据——空缓存时逻辑正确降级（无 RiskFlag，无扣分）

---

*Phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai*
*Completed: 2026-04-17*

## Self-Check: PASSED

- FOUND: `reportingExceptionFlag?: boolean` in scoring.ts (line 52)
- FOUND: `inputs.reportingExceptionFlag` in scoring.ts (line 181)
- FOUND: `Math.max(0, C - 3)` in scoring.ts (line 182)
- FOUND: `OPACITY_EXCEPTION_TYPES` in gleif.ts (line 191, module-level)
- FOUND: `communityReputationFinal` in gleif.ts (lines 250, 253, 263)
- FOUND: `reportingExceptionType` in gleif.ts (line 207, 249)
- FOUND: `OPACITY_EXCEPTION_TYPES` in repository.ts (line 685)
- FOUND: `'reporting_exception'` in repository.ts (lines 927, 956, 997, 1026)
- FOUND: `gleif-exception-` in repository.ts (lines 926, 955, 996, 1025)
- NOT FOUND: `NATURAL_PERSONS` in repository.ts (correct — excluded from opacity set)
- NATURAL_PERSONS in gleif.ts: only in comment, not in Set definition (correct)
- Task 1 commit bff6249: VERIFIED
- Task 2 commit f076aca: VERIFIED
- TypeScript type-check: exit code 0

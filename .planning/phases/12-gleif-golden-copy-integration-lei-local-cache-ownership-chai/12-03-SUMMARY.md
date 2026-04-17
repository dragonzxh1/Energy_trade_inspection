---
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
plan: "03"
subsystem: repository
tags: [gleif, lei, cache-first, repository, postgresql, similarity-search]

requires:
  - "12-01: lei_cache 表 DDL + GIN trigram 索引"
  - "12-02: gleif-golden-copy.ts LeiCacheRow 接口"

provides:
  - "getLeiCacheRecord(lei) — lei_cache 单行读取 helper（repository.ts）"
  - "writeLeiCacheRecord(record) — lei_cache upsert helper，warm-on-miss（repository.ts）"
  - "resolveGleifRecord 两个调用点（lei- 和 gleif: 前缀）均改为缓存优先"
  - "searchEntities() GLEIF 路径 lei_cache SIMILARITY 查询（阈值 0.45）"
  - "getGleifUltimateParentJurisdiction() 缓存优先实现（gleif.ts）"

affects:
  - 12-04  # 风险信号集成（消费 lei_cache 行中的 reporting_exception_type）

tech-stack:
  added: []
  patterns:
    - "lei_cache 缓存优先模式：getLeiCacheRecord → hit 返回，miss 调用实时 API + writeLeiCacheRecord"
    - "searchEntities GLEIF 路径：SIMILARITY(legal_name, $1) > 0.45 + entity_status = ACTIVE，命中则跳过 searchGleifMultiple()"
    - "getGleifUltimateParentJurisdiction：嵌套 try-catch，内层查 lei_cache，失败静默降级到外层实时 API"
    - "Python 字节级修改：repository.ts 包含 GBK 编码注释 + CRLF 换行，Edit 工具无法匹配，改用 Python open(rb)/wb 精确替换"

key-files:
  created: []
  modified:
    - "src/lib/server/repository.ts"
    - "src/lib/server/gleif.ts"

key-decisions:
  - "分两个 if 分支（lei- 和 gleif: 前缀）分别插入 cache-first 逻辑，而非重构为共用函数——符合外科手术式修改原则"
  - "searchEntities 中 cachedGleifRows.length > 0 时将 searchGleifMultiple 替换为 Promise.resolve([])，保留 Promise.all 结构不变"
  - "writeLeiCacheRecord 仅写 Level 1 字段（不写 direct_parent_lei 等），Level 2 由 syncLeiLevel2 负责"
  - "gleif.ts 导入 db 和 LeiCacheRow 放在文件中 import type { SanctionStatus } 之后——匹配文件原有风格（imports 在函数定义之后）"

requirements-completed:
  - D-05
  - D-06

duration: 15min
completed: "2026-04-17"
---

# Phase 12 Plan 03: Cache-First GLEIF LEI Lookup Summary

**在 repository.ts 的 resolveGleifRecord 调用路径和 searchEntities GLEIF 路径插入 lei_cache 缓存优先逻辑；在 gleif.ts 的 getGleifUltimateParentJurisdiction 添加 lei_cache 优先查询（per D-05），缓存命中时完全跳过实时 GLEIF HTTP 请求**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-17T05:05:00Z
- **Completed:** 2026-04-17T05:20:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

**Task 1: repository.ts + gleif.ts 核心修改**

- 添加 `getLeiCacheRecord(lei)` helper：`SELECT * FROM lei_cache WHERE lei = $1 LIMIT 1`，DB 错误时静默返回 null
- 添加 `writeLeiCacheRecord(record)` helper：`INSERT ... ON CONFLICT (lei) DO UPDATE` 写 Level 1 字段，写入错误仅 console.error
- 在 `getEntityByKey` 的 `lei-` 前缀分支插入缓存优先路径：命中直接 resolveGleifRecord，未命中调实时 API + writeLeiCacheRecord warm 缓存
- 在 `getEntityByKey` 的 `gleif:` 前缀分支同样插入相同缓存优先路径
- 导入 `type GleifLeiRecord from './gleif'` 和 `type LeiCacheRow from '@/lib/server/sync/gleif-golden-copy'`
- 在 `gleif.ts` 的 `getGleifUltimateParentJurisdiction` 函数 `try` 块最前面插入嵌套缓存查询：先查实体的 `ultimate_parent_lei`，再查父级的 `jurisdiction`，两者均命中则直接返回，跳过所有实时 API 调用（per D-05）

**Task 2: searchEntities() GLEIF 路径**

- 在 `shouldSearchCompanies && localResults.length === 0` 块中，`Promise.all` 之前插入 `lei_cache` SIMILARITY 查询（阈值 0.45，仅 ACTIVE 实体，LIMIT 5，按相似度降序）
- `cachedGleifRows.length > 0` 时将 `searchGleifMultiple(query, 5)` 替换为 `Promise.resolve([])`，完全跳过实时 API
- 将 LeiCacheRow 结果映射为 `GleifLeiRecord[]`（gleifFromCache），与实时 API 结果合并为 `allGleifRecords`（缓存结果优先）
- 将后续 `gleifRecords.filter(...)` 改为 `allGleifRecords.filter(...)`

## Task Commits

1. **Task 1: repository.ts helper + 缓存优先调用点 + gleif.ts 缓存优先** — `8f51b01` (feat)
2. **Task 2: searchEntities GLEIF 路径 lei_cache 相似度查询** — `ce3f817` (feat)

## Files Created/Modified

- `src/lib/server/repository.ts` — +115 行（2 helpers + 2 缓存优先调用点 + searchEntities 缓存块）
- `src/lib/server/gleif.ts` — +22 行（db + LeiCacheRow import + 缓存优先路径）

## Decisions Made

- **分两个 if 分支各自插入**：`lei-` 和 `gleif:` 前缀分支结构略有不同（前者有 `.toUpperCase()`），合并为共用函数会增加复杂性，不符合外科手术式原则
- **Promise.all 结构保留**：`searchGleifMultiple` 替换为 `Promise.resolve([])`，而非重构为条件分支，保持并发查询结构不变
- **writeLeiCacheRecord 仅写 Level 1**：`direct_parent_lei`/`ultimate_parent_lei` 不写，避免覆盖 syncLeiLevel2 写入的数据

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] GleifLeiRecord 类型未导入**
- **Found during:** Task 1 TypeScript 类型检查
- **Issue:** `writeLeiCacheRecord(record: GleifLeiRecord)` 使用了 `GleifLeiRecord` 类型，但 repository.ts 只导入了 `gleif` 的函数，未导入类型
- **Fix:** 添加 `import type { GleifLeiRecord } from './gleif'`
- **Files modified:** src/lib/server/repository.ts
- **Commit:** 8f51b01

**2. [Rule 1 - Bug] @types/unzipper 未安装（gleif-golden-copy.ts 预存在错误）**
- **Found during:** Task 1 TypeScript 类型检查
- **Issue:** gleif-golden-copy.ts（Plan 02 产物）因 node_modules 未包含 @types/unzipper 和 stream-chain 声明文件而报类型错误，阻断 `npm run type-check`
- **Fix:** 在主项目目录运行 `npm install`，安装缺失的声明包（package.json 中已声明，但 node_modules 中未实际安装）
- **Files modified:** 无（package-lock.json 在主项目 master 分支，不在本 worktree 提交范围内）
- **Commit:** 无独立提交（仅 npm install 操作）

**3. [Rule 3 - Blocking] Edit 工具无法匹配 GBK/CRLF 混合编码内容**
- **Found during:** Task 2 代码修改
- **Issue:** repository.ts 文件内含 Windows 换行符（CRLF）和 GBK 编码的中文注释，Edit 工具的字符串匹配因编码不一致而失败
- **Fix:** 改用 Python3 以二进制模式读写文件，精确定位并替换字节序列
- **Files modified:** src/lib/server/repository.ts（Task 2 修改）
- **Commit:** ce3f817

---

**Total deviations:** 3（2 类型修复 + 1 工具限制绕过）
**Impact on plan:** 功能实现完整，验收标准全部满足。

## Known Stubs

无。

## Threat Flags

实现符合 Plan 的 threat_model 中所有 T-12-03-* 缓解措施：
- T-12-03-01: SIMILARITY 查询使用参数化 `$1`，不拼接 SQL ✓
- T-12-03-02: lei_cache_legal_name_trgm GIN 索引（迁移 037 创建）使 SIMILARITY 扫描高效 ✓
- T-12-03-03: writeLeiCacheRecord 硬编码 entity_status = 'ACTIVE'（来自 live API 的记录已是 ACTIVE）✓
- T-12-03-04: getLeiCacheRecord 返回完整行供调用方使用，reporting_exception_type 保留供 Plan 04 ✓
- T-12-03-05: gleif.ts 引入 db import 使用全局单例 pool ✓

## User Setup Required

None — 缓存优先逻辑在 lei_cache 表为空时自动降级到实时 API，无需额外配置。

## Next Phase Readiness

- Plan 04（风险信号集成）可通过 `getLeiCacheRecord()` 读取 `reporting_exception_type` 和 `reporting_exception_reason` 字段
- 缓存层已就绪：全量同步（Plan 05 dispatch 后）将大量填充 lei_cache，缓存命中率将大幅提升

---

*Phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai*
*Completed: 2026-04-17*

## Self-Check: PASSED

- FOUND: getLeiCacheRecord function in repository.ts (line 639)
- FOUND: writeLeiCacheRecord function in repository.ts (line 652)
- FOUND: SELECT * FROM lei_cache WHERE lei = $1 in repository.ts
- FOUND: ON CONFLICT (lei) DO UPDATE in repository.ts
- FOUND: LeiCacheRow import in repository.ts
- FOUND: ultimate_parent_lei in gleif.ts (lines 253, 257, 260)
- FOUND: Cache-first comment in gleif.ts (line 253)
- FOUND: SIMILARITY(legal_name, $1) > 0.45 in repository.ts (line 471)
- FOUND: cachedGleifRows in repository.ts
- FOUND: cachedGleifRows.length > 0 in repository.ts (line 488)
- FOUND: allGleifRecords in repository.ts (lines 501, 531)
- Task 1 commit 8f51b01: VERIFIED
- Task 2 commit ce3f817: VERIFIED
- TypeScript type-check: exit code 0

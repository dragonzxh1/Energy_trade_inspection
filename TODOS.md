# Energy Trade Inspection Platform — TODOs

---

## Design

### TODO-D1: 色彩对比度自动化验证
- **What:** 在实现阶段使用 axe-core 或 Playwright 无障碍插件自动验证所有深色背景上的文字对比度达到 WCAG AA (4.5:1)
- **Why:** `--text-muted: #64748b` 在某些背景组合下可能不足 4.5:1；状态徽章的"颜色+图标"双重指示需要真实渲染验证
- **Pros:** 避免无障碍漂移，合规审计时有自动化证明
- **Cons:** 首次 CI 集成有一定配置成本
- **Context:** 在 CI/CD pipeline 加入 axe-core 或 `@axe-core/playwright`，每次构建自动执行。关键检查点：`--text-muted` 在 `--bg-surface` 背景下的对比度、所有状态徽章的色彩+文字组合
- **Priority:** P2
- **Depends on:** 基础组件实现完成后

### TODO-D2: 移动端评分条 HTML 原型
- **What:** 为手机端水平评分进度条制作一个独立的 HTML/CSS 原型，确认分数数字（JetBrains Mono）、风险等级标签、制裁状态徽章在 375px 宽度下同一行的布局方式
- **Why:** 评分展示是最核心的 UI 组件，移动端变体需要在开发前目视验证，避免开发阶段决策反复
- **Pros:** 开发时有可参考的实现示例，减少布局返工
- **Cons:** 额外小工作量，约 1-2 小时
- **Context:** 可在制作配色展示页或内容层 HTML 文件时一并完成。目标：375px 宽、单行内展示评分数字 + 风险标签 + 制裁徽章
- **Priority:** P2
- **Depends on:** DESIGN.md 颜色系统确认（已完成）

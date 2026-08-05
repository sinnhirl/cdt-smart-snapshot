# cdt-smart-snapshot bug 修复任务书 ROUND 3

项目路径: /mnt/c/code/cdt-smart-snapshot
当前 HEAD: a347052（v0.1.4 已发布）
来源: 2026-08-05 Hermes 自主长测试（15站×2轮 benchmark），bench-results-3x.json 落盘

## 硬性要求
- 遵守 .cursorrules 和 AGENTS.md：无 any/as/!、禁 ts-ignore、JSDoc 齐全、
  TDD（每个修复先写失败测试再实现）、Conventional Commits
- 架构约束：src/core/ 纯函数、src/tools/ 薄层、src/browser.ts 是唯一
  知道 puppeteer 的地方
- 质量门（必须全过）：npm run typecheck && npm run check-format &&
  npm run test（72 现有 + 新增全绿）

## 背景：为什么会有这个问题

v0.1.4 引入 ROUND2-3（stampOptimisticDomVisibility，大页跳过可见性采集时
乐观标记带 backendNodeId 的节点为可见）。目的是"大页不丢交互节点"。

但实现过激：它把所有带 backendNodeId 的节点都标可见，包括**正文文本**。
大文档页（Wikipedia 类 16K 节点 > VISIBILITY_MAX_NODES）正文全是有
backendNodeId 的 DOM 节点 → 全部被标可见 → 全部保留 → 缩减从 19.3%
暴跌到 2.8%（字符保留率 97%）。

Benchmark 实测（v0.1.4 vs README 记录的 v0.1.0 数据）：
| 站点 | v0.1.0 | v0.1.4 | 变化 |
|------|--------|--------|------|
| Wikipedia (long doc) | 19.3% | 2.8% | -16.5pp ← 严重回归 |
| Baidu (CN search) | 10.4% | -10.5% | -20.9pp ← 变负数 |
| Zhihu (CN Q&A) | 9.4% | -13.2% | -22.6pp ← 变负数 |
| Bilibili (video) | 35.8% | 18.1% | -17.7pp |
| Stack Overflow | 70.6% | 61.7% | -8.9pp |
| CNN | 96.5% | 88.8% | -7.7pp |

（完整数据在 bench/bench-results-3x.json，2/3 rounds 完整）

## 待修复（按优先级）

### #1: stampOptimisticDomVisibility 把正文当交互节点保留（严重回归）
文件: src/core/visibility.ts（stampOptimisticDomVisibility 函数）
- 现状: 大页跳过可见性时，对所有 backendNodeId !== undefined 的节点标
  visible:true。正文文本节点也有 backendNodeId → 大文档页几乎不缩减。
- 修法: 只乐观标记**交互角色**（复用 interaction.ts 的 isInteractiveRole
  判断，或至少排除纯文本节点 role==='text'/'staticText'）。正文段落不该
  被乐观标记，它们没有交互价值；大页上正文让 agent 用 evaluate 按需读。
- TDD: visibility.test.ts 加「stampOptimisticDomVisibility 对 text 节点
  不标 visible、对 button 节点标 visible」测试。
- 验收: Wikipedia 类大页缩减率恢复到 ~15-20%（README v0.1.0 水平）；
  交互锚点（按钮/链接）仍保留。

### #2: Baidu/Zhihu 负缩减（smart 比官方还大）
文件: 待排查（可能是 visibility 或 interaction 过滤对这类页面失效）
- 现状: Baidu -10.5%、Zhihu -13.2%（两轮稳定复现），smart 输出字符数
  反而超过官方 interestingOnly 输出。
- 怀疑: 这些页面官方 interestingOnly 已裁得很干净（~90-104 节点），
  而我们的管线可能因 ROUND2-2（父隐藏提升子节点）把隐藏容器里的
  子节点全提升保留，导致输出膨胀。
- 修法: 排查 ROUND2-2 的提升逻辑是否对"隐藏广告容器"过度保留；
  或接受并文档化（这些页面官方已接近最优，工具无增益）。
- TDD: 构造「父 hidden 容器含多个子节点」树，验证提升后输出不膨胀。
- 验收: 负缩减站点降到 ≥0%，或文档说明这是已知边界。

### #3: benchmark 3 轮跑不完（>20 分钟超时）
文件: bench/multi-site-3x.mjs
- 现状: ROUNDS=3 × 15 站，每站 networkidle2 等待，20 分钟 timeout 只
  跑完 2 轮。README 声称"3 rounds"但实际跑不满。
- 修法: 降低 NAV_TIMEOUT 或改用 domcontentloaded + 固定延迟；或
  README 改称"2 rounds"；或分轮断点续跑（已有落盘机制）。
- 验收: 完整 3 轮在合理时间（<15 分钟）内跑完，或不虚标轮数。

## 验收
- npm run test 全绿（72 现有 + 新增）
- npm run typecheck 零错误
- npm run check-format 零错误
- 每个修复一个 Conventional Commit（fix: ... 注明任务号 ROUND3-N）
- 修完重跑 bench/multi-site-3x.mjs 至少 1 轮，确认 Wikipedia 缩减恢复

## 备注
- 不要动 CHANGELOG/release 配置（Hermes 另行处理）
- #1 是严重回归必须修；#2/#3 是质量改进
- ROUND2-3 的意图（大页不丢交互锚点）要保留，只修"正文也被保留"这半边

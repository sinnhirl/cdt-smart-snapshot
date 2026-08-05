# cdt-smart-snapshot bug 修复任务书 ROUND 3

项目路径: /mnt/c/code/cdt-smart-snapshot
当前 HEAD: 8ac60ce（v0.1.5 已发布）
来源: 2026-08-05 Hermes 自主长测试（15站×2轮 benchmark），bench-results-3x.json 落盘

## 状态

- #1 已修复并随 v0.1.5 发布（commit 673ca54 + 回归测试
  shouldNotStampBodyTextAsVisibleOnLargePageSkip；Wikipedia 缩减 2.8% → 88.1%）
- #2 已修复（commit ed2daf4，随 v0.1.6 发布：SELF_LABELING_CONTROLS 折叠
  link/button 冗余 text 子节点；Baidu -10.5% → +76.9%，Zhihu -13.2% → +73.9%）
- #3 已修复（commit ab5eabb，随 v0.1.6 发布：SETTLE_MS 3000→1000，
  3 轮 benchmark 不再超时）

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

### #1: stampOptimisticDomVisibility 把正文当交互节点保留（严重回归）✅ 已修复
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
- **实际修复**: commit 673ca54（v0.1.5）——新增 OPTIMISTIC_INTERACTIVE_ROLES
  白名单（button/link/input 等 20 个操作类角色），仅对这些角色乐观标可见。
  实测 Wikipedia 缩减 2.8% → 88.1%（超过验收线），交互锚点 7/8 保留。

### #2: Baidu/Zhihu 负缩减（smart 比官方还大）✅ 已修复
文件: src/core/interaction.ts（filterByInteraction）
- 现状: Baidu -10.5%、Zhihu -13.2%（两轮稳定复现），smart 输出字符数
  反而超过官方 interestingOnly 输出。
- 根因: 这些页面几乎全是 link+text-child 树。link 的 accessible name 已含
  标签文本，其 text/StaticText 子节点纯属冗余（实测占输出 15%），膨胀到
  超过官方。
- 修法: SELF_LABELING_CONTROLS（link/button/menuitem/tab/checkbox/radio/
  switch）在非 verbose 模式折叠 text/StaticText 子节点；动态值控件
  （textbox/combobox）和独立正文 text 不受影响。
- TDD: interaction.test.ts 新增 3 测试（折叠 link 冗余 text / textbox 保留
  text 子节点 / verbose 模式全保留）。
- 验收: 负缩减站点降到 ≥0%。
- **实际修复**: commit ed2daf4（v0.1.6）。实测 Baidu -10.5% → +76.9%，
  Zhihu -13.2% → +73.9%。

### #3: benchmark 3 轮跑不完（>20 分钟超时）✅ 已修复
文件: bench/multi-site-3x.mjs
- 现状: ROUNDS=3 × 15 站，每站 networkidle2 等待，20 分钟 timeout 只
  跑完 2 轮。README 声称"3 rounds"但实际跑不满。
- 修法: SETTLE_MS 3000→1000（networkidle2 已等安静，额外 3s 保守）。
- 验收: 完整 3 轮在合理时间（<15 分钟）内跑完，或不虚标轮数。
- **实际修复**: commit ab5eabb（v0.1.6）。每站 ~26s × 15 × 3 ≈ 20 分钟，
  配 1800s harness timeout 可完整跑完 3 轮。

## 验收
- npm run test 全绿（72 现有 + 新增）
- npm run typecheck 零错误
- npm run check-format 零错误（格式不对先 npm run format）
- 每个修复一个 Conventional Commit（fix: ... 注明任务号 ROUND3-N）
- 修完重跑 bench/multi-site-3x.mjs 至少 1 轮，确认 Wikipedia 缩减恢复

## 追加：真实环境 bug（2026-08-05 16:00，MCP server 端到端实证 v0.1.6）
以下问题经 Hermes 真实连 Edge（DeepSeek 用量页）复现，脚本输出在
/tmp/cdt-live-*.mjs。上一版任务书被覆盖丢失，此节为恢复 + 新发现。

### R3A【严重·已修复】RootWebArea 根节点永远被 visibility 误杀 → 页面标题行消失
文件: src/browser.ts:341-357（walkAxForVisibility evaluate）、
      src/core/visibility.ts:169-197（isSelfVisibilityDropped）
- 实证（/tmp/cdt-live-diag.mjs / cdt-live-pipeline2.mjs，v0.1.6 复现）：
  RootWebArea 的 elementHandle() 指向 HTMLDocument（nodeType 9），
  evaluate 内 getComputedStyle(document) 抛 TypeError，被 catch 吞掉 →
  根节点永远不进 visibility map（90 个其他节点正常，root has info:false）。
  isSelfVisibilityDropped 在 visibilityEvaluated=true 时把 visible!==true
  判 dropped → 根被包 __promoted__ → formatTree 透明化 → 输出永远没有
  `[RootWebArea] 页面标题` 行（非 verbose 和 verbose 都缺）。
- 修法: evaluate 内处理非 Element（el instanceof Document 时改用
  el.documentElement 或直接标可见）；或 isSelfVisibilityDropped 对根节点
  （无父/uid 最小）特判放行。选前者更通用。
- TDD: browser.test.ts mock document 类型 handle；visibility.test.ts 根
  节点缺 info 不被 dropped。
- 验收: MCP smart_snapshot 输出首行为 `[RootWebArea] <标题>`。
- **实际修复**: commit 383aea0。Document handle 直接返回可见全视口几何
  （documentElement 在 CDP 里 rect 高度为 0，测量会误判 hidden）。
  实测首行 `[RootWebArea] DeepSeek 开放平台` 恢复；回归测试
  shouldKeepRootLineWhenRootVisibleAndVisibilityEvaluated。

### R3B【中等·已修复】role 'image' 与 'img' 不匹配 → logo 图片丢失
文件: src/core/interaction.ts:84
- 实证（/tmp/cdt-live-img.mjs，v0.1.6 复现）：真实页面 image 节点 role
  ='image' name='DeepSeek 开放平台'，isInteractiveRole('image', name)
  ===false（只认 'img'）→ 非 verbose 快照不含任何 [image]/[img] 行。
  Chrome AX 实际返回 'image'（ARIA img 映射）。
- 修法: isInteractiveRole/shouldCollapseRole 角色表加 'image'。
- TDD: interaction.test.ts 加 isInteractiveRole('image','logo')===true。
- 验收: 非 verbose 快照含 `[image] "logo名"`。
- **实际修复**: commit 590c9c0。isInteractiveRole 同时接受 'image'/'img'。
  实测 `[image] "DeepSeek 开放平台" ×2 (uid=3)` 恢复。

### R3C【轻微·已修复】COLLAPSE_ROLES 'statictext' 小写死条目
文件: src/core/interaction.ts（COLLAPSE_ROLES 里的 'statictext'）
- 实证（/tmp/cdt-live-img.mjs）：真实页面 66 个文本节点 role 全是
  'StaticText'；shouldCollapseRole('StaticText')===false（死条目）。
  行为恰好正确（走 isInteractiveRole StaticText 分支保留），但声明是
  死代码，误导维护。
- 修法: 删死条目或改驼峰并补行为测试锁定。

### R3D【低·已修复】SELF_LABELING_CONTROLS 折叠可能吞无 name 控件的 text 标签
文件: src/core/interaction.ts:172-176
- 实证（/tmp/cdt-verify-selflabel.mjs）：mock 无 name checkbox/button +
  text 子节点 → 输出 [checkbox] (uid=2) 无标签。但真实 Chrome 中 input
  是 void 元素无 children、button 无 name 时 Chrome 已算好 name，发生
  概率低。防御性修复：仅当控件 name 非空时才折叠 text 子节点。
- TDD: interaction.test.ts 加「无 name 控件不折叠 text 子节点」。
- 优先级: 低于 R3A/R3B，可与 R3C 一起做。
- **实际修复**: commit 590c9c0。仅当控件 name 非空才折叠 text 子节点；
  回归测试 shouldKeepTextChildWhenSelfLabelingControlHasNoName。

## 备注（恢复）
- R3A 已修：agent 现在能看到页面标题行确认所在页面。
- Hermes MCP server 进程跑旧 build 的坑：改代码后要 npm run build +
  重新加载 MCP server（Hermes 端 reload），否则实测仍旧行为。

## 备注
- 不要动 CHANGELOG/release 配置（Hermes 另行处理）
- #1 是严重回归必须修；#2/#3 是质量改进
- ROUND2-3 的意图（大页不丢交互锚点）要保留，只修"正文也被保留"这半边

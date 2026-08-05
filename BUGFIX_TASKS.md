# cdt-smart-snapshot bug 修复任务书（Cursor 执行版）

项目路径: /mnt/c/code/cdt-smart-snapshot
当前 HEAD: 42f9a14（C2 diff 基线 + C1 uid 稳定已合入，44/44 测试绿）

## 硬性要求

- 遵守 .cursorrules 和 AGENTS.md：无 any/as/!、禁 ts-ignore、JSDoc 齐全、
  TDD（每个修复先写失败测试再实现）、Conventional Commits
- 架构约束：src/core/ 纯函数、src/tools/ 薄层、src/browser.ts 是唯一
  知道 puppeteer 的地方
- 质量门（必须全过）：npm run typecheck && npm run check-format &&
  npm run test（44 现有 + 新增全绿）

## 已完成（参考，勿重做）

- C2: runSmartSnapshotPipeline 返回 diffRoot（去重/折叠前树），
  smart_snapshot 和 snapshot_diff 用它存 diff 基线。见 SmartSnapshotResult。
- C1: UidMapper.getUidForLogicalPath(parentUid, role, name, siblingIndex)，
  ax-tree.ts normalizeNode 带 parentUid+siblingIndex 递归。

## 待修复（按顺序）

### M2+M6: count/collapsed 纳入 diff 比较 + 文本节点可定位

文件: src/core/diff.ts, src/core/snapshot.ts

- M2: nodesEqual（diff.ts ~line 98）目前只比 role/name/value/visible。
  扩展比较 count/collapsed/childCount；changeDetail 也覆盖这些字段。
- M6: formatNodeLine（snapshot.ts ~line 98）对 text/StaticText 输出
  `[text] "内容"` 不带 uid，但 diff 输出带 uid——agent 无法对应。
  修法: 文本行加 uid（输出 `[text] "内容" (uid=N)`），或 diff 对文本
  输出索引/上下文行号。选前者（保持一致）。
- TDD: diff.test.ts 加「count 变化触发 changed」「collapsed 变化触发
  changed」「文本行含 uid」测试。

### D1+D2: 去重正确性

文件: src/core/dedupe.ts

- D1: 合并条件只有 role+name 相等，checkbox value 状态丢失。
  修法: 合并条件加 value（及 visible/offscreen）相等。
- D2: 合并只保留第一个兄弟，第二个的 children 整个丢弃。
  修法: 仅当 children 为空或子树结构相同时才合并；否则各保留一行。
- TDD: dedupe.test.ts 加「value 不同不合并」「子树不同不合并」测试。

### V1: 大页面可见性（缺几何按隐藏处理）

文件: src/browser.ts, src/core/visibility.ts

- fetchAxTreeWithVisibility 在节点数 > VISIBILITY_MAX_NODES 时跳过
  可见性收集 → visible/offscreen 全 undefined → filterHidden 保留所有。
  核心目标（大页面省 token）在最需要它的页面失效。
  修法: 缺失几何时按 !includeHidden 视为隐藏（filterHidden 对 undefined
  的处理改为「未评估时默认隐藏」），或 CDP DOM.getBoxModel 批量采样。
  选前者（简单），注意不要误删有 backendNodeId 但 geometry 缺失的节点。
- TDD: visibility.test.ts 加「undefined visible 默认隐藏」测试。

### M5: promoted 幽灵行不进 diff 上下文

文件: src/core/diff.ts

- filterByInteraction 生成 role='**promoted**' 包装，formatTree 跳过它，
  但 diff 的 buildContextLines 直接打印 parent.role → 输出 `[__promoted__]`。
  修法: buildContextLines 遇到 **promoted** 向上找真实父节点，或跳过该行。
- TDD: diff.test.ts 加「上下文不含 **promoted**」测试。

### M1: reparenting 检测

文件: src/core/diff.ts

- diff 是 uid 扁平对比，不比较父节点。节点被移动父容器零输出。
  修法: 比较 parent uid（或路径），变化时 emit ~ moved 或
  changed detail "parent X→Y"。注意父 uid 需要能从树里查到
  （可加 childUid→parentUid 映射，或用路径 hash）。
- TDD: diff.test.ts 加「节点换父容器报 changed」测试。

### B1+B2: 连接竞态 + 掉线监听

文件: src/browser.ts

- B1: connectBrowser 无 mutex，两个并行调用都见 browserInstance===
  undefined → 双连接泄漏。修法: in-flight promise 去重（模块级
  pendingConnect 变量）。
- B2: 无 disconnected 监听器，单例不会主动失效。修法:
  browser.on('disconnected', () => { browserInstance = undefined; })。
- TDD: 新增 tests/browser.test.ts（mock puppeteer connect），测并发调用
  只建一条连接、disconnected 事件清空实例。

### N1: 无名交互孙节点保护

文件: src/core/dedupe.ts

- collapseSameNameChildren 的 isSameRoleLinkChain 只查孙节点 name，
  不查 role。link 链里夹的无名 [button] 图标（name 空）会被折掉。
  修法: 折叠条件加 role/交互性检查（无名 button/input 等不可折）。
- TDD: dedupe.test.ts 加「无名 button 不被折叠」测试。

### B4: CDT_MAX_DEPTH 接线

文件: src/tools/smart_snapshot.ts, src/config.ts

- defaultMaxDepth 算好放进 AppConfig 但无人消费（tools 用 zod default 8）。
  修法: handler 里 maxDepth ?? loadConfig().defaultMaxDepth。
- TDD: tools.test.ts 加「未传 maxDepth 时用环境变量默认」测试。

## 验收

- npm run test 全绿（44 现有 + 新增）
- npm run typecheck 零错误
- npm run check-format 零错误（格式不对先 npm run format）
- 每个修复一个 Conventional Commit（fix: ...），提交信息注明任务号
  （如 "fix: include count/collapsed in diff comparison (M2)"）

## 备注

- 做完后不要动 CHANGELOG/release 配置（Hermes 另行处理）
- 如某个修复发现设计有问题或测试写不下去，跳过并在最终输出里说明原因，
  不要擅自改架构

# cdt-smart-snapshot bug 修复任务书 ROUND 2（Cursor 执行版）

项目路径: /mnt/c/code/cdt-smart-snapshot
当前 HEAD: ac36322（v0.1.1 已发布，58/58 测试绿）
来源: 2026-08-05 Cursor Agent 全量审查（16 项，逐条经 Hermes 读源码核对确认）

## 硬性要求
- 遵守 .cursorrules 和 AGENTS.md：无 any/as/!、禁 ts-ignore、JSDoc 齐全、
  TDD（每个修复先写失败测试再实现）、Conventional Commits
- 架构约束：src/core/ 纯函数、src/tools/ 薄层、src/browser.ts 是唯一
  知道 puppeteer 的地方
- 质量门（必须全过）：npm run typecheck && npm run check-format &&
  npm run test（58 现有 + 新增全绿）

## 已完成（勿重做）
- BUGFIX_TASKS.md 的 9 项（M2+M6/D1+D2/V1/M5/M1/B1+B2/N1/B4）已在
  commit 3b2bb52 合入并发布 v0.1.1。
- 本轮 16 项与上一轮不重叠，但 #1/#2/#3 涉及 visibility 管线，
  注意与 V1（大页 hideUnevaluated）的既有行为协同，别破坏它。

## 待修复（按优先级：先 #1-#6 中等，后 #7-#16 轻微）

### #1: 缺几何信息节点被强制 visible:true
文件: src/core/visibility.ts:76-88（applyVisibility）
- 现状: info===undefined 时，若 root.backendNodeId!==undefined 且
  infoByUid.size>0（部分节点已采集），返回 visible:true, offscreen:false。
  真实原因（elementHandle() 为 null、evaluate 失败、walk 中 catch 跳过）
  采集失败的单点会被误标可见，隐藏节点漏进快照。
- 修法: 缺 geometry 不要「有 backendNodeId ⇒ visible」；与 hideUnevaluated
  语义一致（默认隐藏或单独 visibilityUnknown 状态），至少区分「大页全
  跳过」（infoByUid 空，保留现状）与「单点采集失败」（不再强标可见）。
- TDD: visibility.test.ts 加「map 非空、某 backendNodeId 无条目且 mock
  display:none 时，filterHidden(..., hideUnevaluated=false) 应剔除该节点」。
- 验收: 修复后 #3 大页 regression 不回归（见 #3 验收）。

### #2: 父隐藏时整棵子树丢弃，不提升可见子节点
文件: src/core/visibility.ts:116-142（filterHidden）
- 现状: 父 visible===false 或 offscreen===true 时直接 return undefined，
  整棵子树丢弃（注释写明 no promotion）。父容器隐藏、子控件独立可见
  可交互的 AX 结构会丢节点。
- 修法: 父被滤掉时仍递归处理子节点，surviving 子提升到父级；与 SPEC
  「hidden 默认丢弃」语义对齐，交互 promotion 阶段不冲突。需加回归用例。
- TDD: 构造父 visible:false、子 button visible:true 的树，
  runSmartSnapshotPipeline(includeHidden:false) 输出应仍含该 button。
- 验收: 上述单测绿；真实页面（下拉菜单收起的子项）不丢交互节点。

### #3: 大页跳过几何采集时隐藏 DOM 节点泄漏（V1 只修了一半）
文件: src/browser.ts:406-411、src/core/visibility.ts:125-131
- 现状: nodeCount > VISIBILITY_MAX_NODES 时 visibilityByBackendId 为空，
  hideUnevaluated 只丢「无 backendNodeId」的节点；带 backendNodeId 的
  隐藏 DOM 节点未验证可见性仍全量进快照，「大页省 token」核心目标失效。
- 修法: 大页 fast path 对带 id 节点做批量 DOM.getComputedStyle / 采样
  （cheap 信号：display/visibility/opacity），或默认「visible!==true 且
  无 geometry 的有 id 节点」也隐藏（产品取舍文档化）。注意 #1 修法与其
  协同，别把「有 DOM handle ⇒ 可见」当成新常态。
- TDD: visibility.test.ts 加「hideUnevaluated=true、有 backendNodeId 但
  无 geometry、mock display:none → 隐藏」测试。
- 验收: Wikipedia 类大页 visibilitySkipped===true 时，修复前后 smart
  字符数对比显著下降；隐藏装饰节点不占主导。

### #4: diff removals 不按 DOM 序交错（违反 SPEC §5.6）
文件: src/core/diff.ts:182-221
- 现状: 先 BFS curr（added/changed），再 BFS prev（removed），所有
  removed 条目排在 added/changed 之后。SPEC §5.6 要求 removals「在父
  位置交错」。prev A,B,C 移除 B、改 A 时，`- B` 应出现在 A2 与 C 之间
  而非块尾。
- 修法: 统一遍历序合并 removal（按 DOM 序交织 added/changed/removed），
  或改 SPEC 文档（优先前者）；shouldSortOutputByDomOrder 断言加强为
  removal 相对 sibling 位置。
- TDD: diff.test.ts 加「prev A,B,C 移除 B 改 A → `- B` 在 A2 与 C 之间」
  测试。
- 验收: 上述测试绿；现有 15 个 diff 测试不回归。

### #5: 全局可变状态并行交错
文件: src/core/diff.ts:21（previousSnapshot）、src/core/uid.ts:107
（defaultUidMapper）、src/tools/smart_snapshot.ts、src/tools/snapshot_diff.ts
- 现状: previousSnapshot / defaultUidMapper 是进程级全局可变状态；MCP
  并行 CallTool（多 client 或 fast agent）时 diff 基线会被交错覆盖、
  logical-path uid 与树构建交错。
- 修法: 工具层串行化 snapshot 类工具（模块级 promise 队列/mutex），或
  per-session 上下文（transport session id）；至少文档声明「勿并行调用
  snapshot 工具」。优先队列方案。
- TDD: tools.test.ts 加「并发两次 handleSnapshotDiff（mock 延迟）基线
  一致、第二次 diff 正确」测试。
- 验收: 并行调用测试绿；真实并发无基线覆盖。

### #6: connected=false 重连不清理旧连接
文件: src/browser.ts:132-144（connectBrowser）
- 现状: browserInstance!==undefined 但 connected===false 时走
  establishConnection() 新建连接，未对旧 Browser 调 disconnect()，
  可能遗留 CDP WebSocket / 监听器（B1 mutex 已修，此变体未覆盖）。
- 修法: 重连前 void old.disconnect() 并移除 listener；或始终依赖
  disconnected 事件清理（watchBrowserDisconnect 已清 singleton）。
- TDD: browser.test.ts 扩展：mock connected:false 未 emit disconnected
  后再 connectBrowser，断言 connect/disconnect 调用次数。
- 验收: 上述测试绿；断线重连无连接泄漏。

### #7: diffRoot 在 dedupe/collapse 前截取，M2 比较字段生产路径恒 undefined
文件: src/core/snapshot.ts:180-188、src/core/diff.ts:98-107
- 现状: diffRoot = dedupe/collapse/prune 之前的树（C2 为稳定 uid 的设计），
  nodesEqual 比较的 count/collapsed/childCount 在真实 diffRoot 上几乎恒为
  undefined；M2 单测通过 computeDiff 手工注入字段，与生产路径脱节。
- 修法: 文档明确「diff 不报告 ×N / [+] 折叠变化」，删除误导性比较字段
  或只在展示树（root）上 diff 展示相关属性；不要破坏 uid 稳定性。
- TDD: 集成测「两次 pipeline 仅 dedupe 合并数变化时 snapshot_diff 行为」
  先定产品预期（改文档 or 改实现二选一）再写测。
- 验收: 文档与行为一致；M2 测试不回归。

### #8: nodesEqual 不含 offscreen
文件: src/core/diff.ts:98-107、src/types.ts（SPEC §5.6）
- 现状: 「相同」判定含 visible 不含 offscreen；includeHidden:true 时节点
  仅 offscreen 变化不报 ~ changed。
- 修法: offscreen 纳入 nodesEqual 与 changeDetail；或默认模式 offscreen
  已被滤掉则文档说明。
- TDD: diff.test.ts 加「includeHidden:true、同一 uid offscreen false→true
  报 changed」测试。
- 验收: 上述测试绿。

### #9: 无 backendNodeId 节点 siblingIndex 连锁错位
文件: src/core/uid.ts:76-90（getUidForLogicalPath）、src/core/ax-tree.ts:75-110
- 现状: 无 id 节点 identity = (parentUid, role, siblingIndex)（有意排除
  name 保证文本变化报 changed）；同级前插/删除使后续 siblingIndex 整体
  错位 → 连锁 spurious removed+added（非 reparent）。
- 修法: 文档限制，或 list diff 启发式（内容相似度匹配）；有 id 节点主
  路径不受影响。
- TDD: uid.test.ts 加「前插后旧 sibling 不再错误 ±」场景（定产品预期后）。
- 验收: 文档说明 + 测试绿。

### #10: disconnectBrowser 未 await disconnect
文件: src/browser.ts:163-167
- 现状: void browserInstance.disconnect() fire-and-forget，随后立即
  clearBrowserInstance()，关闭时序不确定。
- 修法: await browserInstance.disconnect()（测试/shutdown 路径）。
- TDD: browser.test.ts 加「断开后立即 connectBrowser 不复用半开连接」。
- 验收: 测试绿。

### #11: evaluate 抛错时 elementHandle 不 dispose
文件: src/browser.ts:311-347（walkAxForVisibility 内循环）
- 现状: handle.dispose() 仅在 evaluate 成功后执行；evaluate 抛错走 catch
  跳过，handle 未 dispose，长会话 CDP/内存压力累积。
- 修法: try/finally 包裹 handle（evaluate 无论成败都 dispose）。
- TDD: browser.test.ts mock evaluate 抛错，断言 dispose 仍被调用。
- 验收: 测试绿。

### #12: getLastConnectError() 无人使用
文件: src/browser.ts:153-155、src/tools/smart_snapshot.ts、snapshot_diff.ts
- 现状: getLastConnectError() 已实现但工具层未用；连接失败依赖 throw 的
  Error.message，且 retry 只保留最后一次错误（firstErr 被 secondErr 掩盖）。
- 修法: 工具 catch 时优先 getLastConnectError()，或合并 first/second 错误
  信息。
- TDD: tools.test.ts mock 第一次失败第二次成功/失败，断言客户端 message。
- 验收: 测试绿。

### #13: MCP server 版本号硬编码 0.1.0
文件: src/index.ts:61 vs package.json:4（0.1.1）
- 现状: createServer 声明 version:'0.1.0'，包版本已 0.1.1，initialize
  元数据与 npm 包不一致。
- 修法: 从 package.json 读取（如 createRequire + require）或统一常量文件。
- TDD: tools.test.ts 加「initialize 返回版本 === package.json version」。
- 验收: 测试绿；tools/list 版本一致。

### #14: snapshot_diff 硬编码 verbose:false
文件: src/tools/snapshot_diff.ts:75-78 vs SPEC Tool 2 schema
- 现状: options.verbose 恒为 false，schema 未暴露 verbose 参数，与
  smart_snapshot「Same as」描述不一致（无容器节点）。
- 修法: schema 加可选 verbose 并透传；或改描述（与 smart_snapshot 对齐
  优先前者）。
- TDD: tools.test.ts 加「snapshot_diff verbose:true 输出含容器」。
- 验收: 测试绿；带 landmark 容器页两工具输出角色集合一致。

### #15: screenshot_to_disk directory 无校验
文件: src/tools/screenshot_to_disk.ts:117-121
- 现状: directory 来自参数或 config.screenshotDir，mkdir 前无任何校验，
  可写任意路径（误用/恶意路径风险）。
- 修法: resolve + 前缀检查限制在 CDT_SNAPSHOT_DIR 子路径（或 config
  screenshotDir），越界拒绝。
- TDD: tools.test.ts 加「../../../etc 类路径被拒绝或归一化」。
- 验收: 测试绿。

### #16: uid mapper 进程生命周期不淘汰
文件: src/core/uid.ts:22-48
- 现状: byBackendId / byLogicalPath / nextUid 只增不减，极端长会话内存
  单调增长。
- 修法: 文档说明（稳定 diff 需要持久 mapper）+ 可选 LRU 或随 page
  navigation 重置（权衡 diff 语义）；最低限度 JSDoc 明确。
- TDD: uid.test.ts 加 mapper 大小上限断言（若实现 LRU）。
- 验收: 文档 + 测试绿。

## 验收
- npm run test 全绿（58 现有 + 新增）
- npm run typecheck 零错误
- npm run check-format 零错误（格式不对先 npm run format）
- 每个修复一个 Conventional Commit（fix: ...），提交信息注明任务号
  （如 "fix: filter hidden nodes without geometry as hidden (ROUND2-1)"）

## 备注
- 做完后不要动 CHANGELOG/release 配置（Hermes 另行处理）
- 如某个修复发现设计有问题或测试写不下去，跳过并在最终输出里说明原因，
  不要擅自改架构
- #1/#3 是同一 visibility 管线的两面，建议一起做一起测

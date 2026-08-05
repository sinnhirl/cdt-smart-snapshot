# cdt-smart-snapshot bug 修复任务书 ROUND 4（v0.2.0 新功能）

项目路径: /mnt/c/code/cdt-smart-snapshot
基线 HEAD: fa2d4c9（v0.2.0 已发布，104/104 测试绿）
来源: 2026-08-05 Hermes 规格逐条核对 + 真实 Edge 端到端实证
（规格文档: Desktop/cdt-smart-snapshot_R4_功能概述.md）

## 硬性要求
- 遵守 .cursorrules 和 AGENTS.md：无 any/as/!、禁 ts-ignore、JSDoc 齐全、
  TDD（每个修复先写失败测试再实现）、Conventional Commits
- 架构约束：src/core/ 纯函数、src/browser.ts 唯一碰 puppeteer、
  src/tools/ 薄层
- 质量门（必须全过）：npm run typecheck && npm run check-format &&
  npm run test（104 现有 + 新增全绿）

## 已完成（勿重做）
- ROUND1-3 全部修复（v0.1.1 → v0.1.7）
- R4 新功能实现完整：5 工具注册齐全（index.ts TOOLS 数组 + CallTool 分支）、
  uid-index/selector 纯函数模块存在、索引刷新用 diffRoot 接线正确

## 待修复（按优先级）

### R4-1【严重·已修复】DOM 反查 100% 失败：CDP objectId 跨 session 失效
文件: src/browser.ts:834-848（resolveBackendNodeObjectId）、861-884（queryDomByBackendNodeId）
- 实证（/tmp/cdt-r4-debug-session.mjs，真实 Edge）：
  - 手动单 session：DOM.resolveNode → Runtime.callFunctionOn 成功
  - 正式函数：session A resolveNode 拿到 objectId，session B callFunctionOn
    报 `Protocol error (Runtime.callFunctionOn): Could not find object
    with given id`
  - 结果：get_node / element_to_selector 对任何 backendNodeId 的 DOM 反查
    全部返回 undefined（image 5/5、button 等全失败），只能走 domState:
    unavailable 降级路径
- 根因: CDP objectId 绑定创建它的 session；queryDomByBackendNodeId 在
  resolveBackendNodeObjectId 内部 createCDPSession() 后，又自己
  createCDPSession() 调 callFunctionOn——两个不同 session。
- 修法: 同一 session 内完成 resolve + callFunctionOn（把 resolve 逻辑
  并入 queryDomByBackendNodeId，或让 resolveBackendNodeObjectId 返回
  {client, objectId} 供复用）。
- TDD: browser.test.ts mock createCDPSession 返回带 sessionId 的 client，
  断言 resolve 和 callFunctionOn 用的是**同一个** session 实例。
- 验收: 真实 Edge 上 get_node(uid=image) 输出 cssSelector/rect/visible，
  element_to_selector 返回唯一 selector。

### R4-2【中等·已修复】diagnosticsAttached 用 Set 非 WeakSet（规格 7.1 违反）
文件: src/browser.ts:542
- 规格 7.1 明确要求「必须用 WeakSet<Page> 去重；disconnectBrowser 时
  清空已 attach 集合」；实现是 `new Set<Page>()`。
- 影响: Set 强引用 Page，长时间运行期间关闭的标签页对象不被 GC，
  内存累积（每 Page 挂 3 个 listener + buffer 数组）。
- 修法: 改 `new WeakSet<Page>()`（其余逻辑不变）。
- TDD: browser.test.ts 加「disconnect 后 diagnosticsAttached 不含旧
  Page（weak 语义难直接断言，可断言 clear 后重新 attach 不重复挂）」。
- 验收: 类型检查通过，attach 去重测试仍绿。

### R4-3【中等·已修复】selector 双实现分叉风险（规格 4.2/5.2 违反）
文件: src/core/selector.ts vs src/browser.ts:742-825（DOM_STATE_READER_FUNCTION）
- 规格 4.2 说「生成逻辑本身纯函数可单测；browser.ts 只做 objectId →
  evaluate 包装」；实际 browser.ts 把整段 buildSelector 策略链内联成
  字符串，与 core/selector.ts 完全重复。
- 更严重：**selector.ts 在运行时是死代码**——src/ 下没有任何文件
  import 它（grep 确认只有 tests/selector.test.ts 用到）。单测测的是
  buildSelectorFromNode，真机跑的是 DOM_STATE_READER_FUNCTION 内联
  字符串：今天行为一致，未来改任一边另一边不同步，就会进入"单测
  全绿、真机行为不同"的状态。
- 当前两版逻辑恰好一致，但已出现维护分叉隐患（core 版有 tagOnly 策略、
  browser 版也有 tagHit——规格 3.3 策略链里没有 tagOnly，是两版各自
  擅自加的，且**没有对应测试**）。
- 修法: 二选一——(a) 运行时也走 buildSelectorFromNode（把函数体字符串
  化注入浏览器，browser.ts 只做 evaluate 包装，符合 spec 4.2 原意）；
  (b) 删掉 selector.ts 只保留一份实现（browser 内联），tests/selector
  .test.ts 改为测试 browser 侧。推荐 (a)。至少补「tagOnly 兜底」行为
  测试并更新规格 3.3 说明允许 tag 兜底。
- TDD: selector.test.ts 加「单元素页面 tag 兜底返回 tag」测试锁定行为。
- 验收: 两处策略一致；规格 3.3 与实现一致；selector.ts 不再死代码
  （或被删除后无残留引用）。

### R4-4【轻微·已修复】get_node 输出 cssSelector 可能为空字符串
文件: src/tools/get_node.ts:104
- DOM_STATE_READER_FUNCTION 的 buildSelector 全部策略失败时返回 ''
  （firstUnique 返回 ''），get_node 直接 `cssSelector: ` 空输出，
  与规格「cssSelector 行」应有值不符。
- 修法: dom.cssSelector 为空时省略该行，或输出 `cssSelector: (none)`。
- TDD: tools.test.ts mock queryDomByBackendNodeId 返回 cssSelector:''，
  断言输出不含空 cssSelector 行。
- 验收: 测试绿。

### R4-5【轻微·已修复】page_status 相对时间戳格式与规格示例不一致
文件: src/tools/page_status.ts:59-70（formatAge）
- 规格示例 `(2 min ago)`；实现 60 秒内输出 `5 sec ago`、超小时 `2 hr
  ago`。agent 解析兼容性风险（规格文档只给了 min 示例）。
- 修法: 与规格对齐（<60s 显示 `0 min ago` 或保持 sec 并更新规格）——
  二选一，统一。
- TDD: 无强制，formatAge 加单测锁定格式。
- 验收: 测试绿；输出与规格示例一致。

### R4-6【轻微·已修复】console 小节混入 warn（spec 前后矛盾）
文件: src/browser.ts:653-656、spec（R4 概述文档 3.4 节）
- 现状: page.on('console') 同时收 error 和 warn（653 行 type !== 'error'
  && type !== 'warn'），page_status 的 "Console errors" 标题下会出现
  [warn] 行。
- 规格矛盾: 概述文档 112 行写「只存 error 级」，但 104 行示例又含
  `[warn] Deprecated API`——spec 自相矛盾。实现与示例一致（收 warn），
  与文字描述不一致。
- 修法: 二选一——(a) 只存 error（改 653 行过滤，删示例 warn 行）；
  (b) 保留 warn（推荐，信息量更大）并把 spec 112 行改为「只存
  error/warn 级」消除矛盾。选 (b) 时页签标题可改为 "Console messages"
  或保持 "Console errors"（文档说明含 warn）。
- TDD: browser.test.ts 加「warn 级 console 是否入 buffer」测试锁定行为。
- 验收: 测试绿；spec 文字与实现一致。

## 已核对无问题的项（勿动）
- page_search 的 Found N / maxResults / more 逻辑正确（hits 与 allMatches
  分别计算，N 与实际行数一致）
- 索引刷新用 diffRoot 正确（smart_snapshot:127、snapshot_diff:114）
- __promoted__ 包装在 buildUidIndex 中正确扁平化
- page_search/get_node/element_to_selector/page_status/snapshot_index
  全部不走 runExclusiveSnapshotTool（符合规格 5.5 并发设计）
- 导航检测（requireSnapshotUidIndex URL 比对）正确
- schema 校验（keyword min 1 / uid 正整数 / maxResults 1-100）正确
- 工具注册（TOOLS 数组 + CallToolRequest 分支）完整

## 验收
- npm run test 全绿（104 现有 + 新增）
- npm run typecheck 零错误
- npm run check-format 零错误
- 每个修复一个 Conventional Commit（fix: ... 注明任务号 ROUND4-N）
- R4-1 修复后必须真机验证：get_node 能输出 cssSelector/rect/visible，
  element_to_selector 返回唯一 selector 可被官方 chrome-devtools-mcp 使用

## 备注
- R4-1 是核心功能 bug，get_node/element_to_selector 在真实浏览器上完全
  不可用（单元测试全用 mock 未覆盖真实 CDP session 语义）——必须先修。
- 不要动 CHANGELOG/release 配置（Hermes 另行处理）
- 验证脚本: /tmp/cdt-r4-integration.mjs、/tmp/cdt-r4-debug-session.mjs

# cdt-smart-snapshot FEATURE SPEC — ROUND 4: 查询内核 + 感知增强工具

项目路径: /mnt/c/code/cdt-smart-snapshot
当前 HEAD: 62d52e9（v0.1.7 已发布）
执行方: Cursor Agent CLI（agent -p --trust --output-format text）
质量门执行方: Hermes（typecheck / test / check-format / 真机验证）

## 0. 硬性要求（与 .cursorrules / AGENTS.md 一致）

- 无 `any` 类型；无 `as` 断言；无 `!` 非空断言
- JSDoc 齐全（函数级 @param/@returns/@throws）
- 架构约束：src/core/ 纯函数（不 import puppeteer）；src/browser.ts 是
  唯一 import puppeteer-core 的模块；src/tools/ 薄层（只做参数解析 +
  调用 browser/core + 格式化输出）
- TDD：每个新行为先写失败测试（vitest），再实现
- Conventional Commits：每个逻辑单元一个 commit（feat: ...）
- 质量门（Hermes 会跑）：npm run typecheck && npm run check-format && npm run test
- 先读取原文件内容，修改后完整写入原路径（Cursor 必须 read-then-write）

## 1. 背景

项目已有三个工具：smart_snapshot（语义压缩快照）、snapshot_diff（uid
增量）、screenshot_to_disk（截图存盘）。核心资产是稳定 uid（基于
backendNodeId 由 UidMapper 分配）。

本轮目标（来自产品规划，两个方向窗口已确认）：
- A. uid 查询内核 + page_search + get_node + element_to_selector
- B. page_status（独立，事件 buffer）

## 2. 新工具总览（5 个）

| 工具 | 作用 | 依赖内核 |
|------|------|---------|
| page_search(keyword) | 在最近快照树上搜文本，返回命中 uid+上下文 | A |
| get_node(uid) | 单节点详情：role/name/value/checked/坐标/CSS selector | A |
| element_to_selector(uid) | uid 反查 CSS 选择器（给官方 MCP 的 click/fill 用） | A |
| page_status() | URL/title/readyState/loading/console error/pageerror/失败请求 | B |
| snapshot_index() | （内核自省）列出最近快照的 uid 索引，agent 探索用 | A |

## 3. A. uid 查询内核（src/core/uid-index.ts 新建）

### 3.1 设计

纯函数模块（不 import puppeteer），保存"最近一次快照的 uid → 节点信息"
映射，供查询工具使用。核心是三个纯函数 + 一个可注入的 DOM 反查接口。

```
uid-index.ts 导出：
  interface UidIndexEntry {
    uid: number;
    backendNodeId?: number;
    role: string;
    name: string;
    value?: string;
    checked?: boolean;     // checkbox/radio/switch
    placeholder?: string;
    path: string;          // 从根到该节点的 role/name 链，如 "main > button \"Go\""
    childCount: number;
  }

  buildUidIndex(root: TextSnapshotNode): Map<number, UidIndexEntry>
    - BFS 遍历 TextSnapshotNode 树，为每个节点生成 UidIndexEntry
    - path 用 role + name（name 为空时只 role）拼接，children 之间 " > "
    - checked/placeholder 从哪来？TextSnapshotNode 里没有这些字段——见 3.2

  searchIndex(index, keyword, maxResults=20): UidIndexEntry[]
    - 大小写不敏感子串匹配 name（优先）、value、path
    - 按匹配位置排序：name 开头 > name 包含 > value/path 包含
    - 最多 maxResults 条

  lookupIndex(index, uid): UidIndexEntry | undefined
    - Map.get
```

### 3.2 checked/placeholder 的获取（关键设计决策）

TextSnapshotNode 目前没有 checked/placeholder 字段。两个选项：

- 选项 1：extend TextSnapshotNode 类型，normalize 时从 AX 树带过来。
  AX 树（SerializedAXNode）有 checked 字段（'true'/'false'/'mixed'），
  但 placeholder 不在 AX 树里。
- 选项 2（推荐）：checked/placeholder 通过 DOM 反查补（见 3.3）。AX
  树的 checked 只覆盖原生控件；DOM 反查能拿到 ARIA/自定义控件的真实状态。

结论：**checked/placeholder 走 DOM 反查**（3.3），不在 normalize 层扩展
类型。UidIndexEntry.checked 只在 DOM 反查成功时填充，否则 undefined。

### 3.3 uid → DOM 反查（src/browser.ts 增加函数）

browser.ts 增加（这是唯一能碰 puppeteer 的地方）：

```
export interface DomNodeState {
  tagName: string;
  cssSelector: string;      // 见 3.4 selector 生成
  value?: string;           // input/textarea/select 的 value
  checked?: boolean;        // input[type=checkbox/radio]
  placeholder?: string;
  disabled?: boolean;
  textContent?: string;     // 截断到 200 字符
  rect?: {top,left,width,height};  // getBoundingClientRect
  visible: boolean;         // 简化：offsetParent !== null || rect 有尺寸
}

export async function queryDomByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<DomNodeState>
```

实现要点：
- 用 CDP DOM 域：`page._client().send('DOM.describeNode', {backendNodeId})`
  拿 nodeId → `DOM.resolveNode` 拿 objectId → Runtime.callFunctionOn 读取
  属性。**或者**更简单：page.evaluate + 全局注册一个临时函数按
  backendNodeId 查（注意 puppeteer 没有直接"backendNodeId → element"
  的 API——AX snapshot 返回 backendNodeId，但 DOM 域需要 nodeId）。
  **推荐实现**：CDP 三步：
  1. `DOM.getDocument`（或复用现有 document nodeId）
  2. `DOM.querySelectorAll` 不行（需要先有 selector）——改用：
     `DOM.describeNode({backendNodeId})` → 返回 nodeId
  3. `DOM.resolveNode({backendNodeId})` → 返回 objectId
  4. `Runtime.callFunctionOn({objectId, functionDeclaration, returnByValue:true})`
     在浏览器里读 tagName/value/checked/placeholder/disabled/textContent/
     getBoundingClientRect
- 跨页面导航后 backendNodeId 会失效（旧映射的 objectId 无效）。调用时
  捕获错误返回 undefined（调用方兜底）。

### 3.4 CSS selector 生成（src/browser.ts 增加函数，或 src/core/selector.ts）

```
export async function elementToSelector(
  page: Page,
  backendNodeId: number,
): Promise<string | undefined>
```

策略（对齐官方 chrome-devtools-mcp 风格）：
1. `DOM.resolveNode({backendNodeId})` → objectId
2. 浏览器里生成：
   a. 若有 `@data-testid` / `data-testid` → `[data-testid="..."]`（唯一时）
   b. 若有 id → `#id`（document.querySelectorAll 唯一时）
   c. 否则逐级向上拼 class 组合，每级验证唯一性：
      `div.foo > button.bar`
   d. 最后兜底 nth-of-type 路径：`html > body > div:nth-of-type(2) > button:nth-of-type(1)`
3. 每次生成后 `document.querySelectorAll(selector).length === 1` 验证，
   不唯一则降级下一策略；全部失败返回 undefined

放在 src/browser.ts（要碰 page 的 Runtime），但生成逻辑本身可以写成
纯函数 `buildSelectorFromNode(el)` 放 src/core/selector.ts（便于单测：
mock 元素结构测策略顺序），browser.ts 只做 objectId → evaluate 包装。

### 3.5 索引生命周期

- 快照工具（smart_snapshot / snapshot_diff）每次成功调用后，用
  `buildUidIndex(diffRoot)` 刷新内存索引（diffRoot 是 pre-dedupe/collapse
  的树，uid 完整）。
- 查询工具（page_search/get_node/element_to_selector）读取该索引。
  索引为空时返回提示"先调用 smart_snapshot 或 snapshot_diff"。
- 导航检测：getActivePage 的 url 变化时清索引（在 browser.ts 记录
  lastActiveUrl，getActivePage 返回的 url 不同则调用方清空——或者
  更简单：索引带 snapshotUrl 字段，查询时对比当前页 url，不同则提示
  "页面已导航，请重新快照"）。

## 4. 工具实现（src/tools/ 新文件）

### 4.1 page_search（src/tools/page_search.ts）

```
schema: { keyword: z.string().min(1), maxResults: z.number().int().min(1).max(100).default(20) }
输出（textResult）：
  Found N matches for "keyword":
  1. [button] "Search" (uid=42) — main > form > button "Search"
  2. [link] "Advanced search" (uid=87) — main > nav > link "Advanced search"
  每行：编号. [role] "name" (uid=N) — path
  maxResults 超出时末尾: ... and M more
无匹配: No matches for "keyword" in the current snapshot. (Call smart_snapshot first if the index is empty.)
错误: 索引为空 → errorResult("No snapshot yet. Call smart_snapshot or snapshot_diff first.")
```

### 4.2 get_node（src/tools/get_node.ts）

```
schema: { uid: z.number().int().positive() }
输出（textResult）：
  uid=42 [button] "Search"
  path: main > form > button "Search"
  value: (如果 DOM 反查有)
  checked: true/false (如果 DOM 反查有)
  placeholder: "..." (如果 DOM 反查有)
  disabled: false
  cssSelector: [data-testid="search-btn"]
  rect: {top: 100, left: 200, width: 80, height: 32}
  visible: true
  childCount: 0
错误: uid 不在索引 → errorResult(`uid ${uid} not found in the current snapshot. ...`)
      DOM 反查失败 → 输出索引内已知字段 + "domState: unavailable"
```

### 4.3 element_to_selector（src/tools/element_to_selector.ts）

```
schema: { uid: z.number().int().positive() }
输出（textResult，纯一行给 agent 复制）：
  [data-testid="search-btn"]
  或
  #search
  或
  div.main-content > button.submit-btn
  或
  html > body > div:nth-of-type(2) > button:nth-of-type(1)
错误: uid 不在索引 → errorResult(...)
      反查失败 → errorResult("Could not resolve uid ${uid} to a DOM element. The page may have navigated; call smart_snapshot again.")
```

### 4.4 page_status（src/tools/page_status.ts）— B 独立

```
schema: { clear: z.boolean().default(false).describe('Clear accumulated console/error buffers after returning.') }
输出（textResult）：
  URL: https://example.com
  Title: Example
  readyState: complete
  loading: false
  Console errors (recent 5):
    - [error] Failed to load resource: 404 (2 min ago)   ← 时间戳
    - [warn] Deprecated API (5 min ago)
  Page exceptions (recent 3):
    - TypeError: Cannot read properties of undefined (3 min ago)
  Failed requests (recent 5):
    - GET https://cdn.example.com/app.js → 404 (4 min ago)
  (None) 表示无记录
```

实现（browser.ts 增加）：
- `attachPageDiagnostics(page)`：挂 page.on('console'/'pageerror'/
  'requestfailed')，累积到模块级环形 buffer（cap 各 20 条，带时间戳）。
  监听器挂在 connect 生命周期（establishConnection 成功后 attach 到所有
  现有 page？不——page 是动态的，改为在 getActivePage 返回前懒 attach，
  或用一个 WeakSet<Page> 记录已 attach 的 page 防重复挂）。
- 关键坑（来自 ROUND2-6/ROUND2-10 的教训）：**重连后监听器不能重复挂**。
  用 WeakSet 或 Set 去重；disconnectBrowser 时清空已 attach 集合。
- `getPageDiagnostics(page)`：返回 {consoleErrors, pageExceptions, failedRequests}
  各取最近 N 条（默认 5）。
- `clearPageDiagnostics(page)`：清空该 page 的 buffer。
- loading 判定：`page.evaluate(() => document.readyState !== 'complete' ||
  document.querySelectorAll('img[src],script[src]').length 且有 pending
  resource）——简化：readyState === 'loading' 时 loading=true，否则用
  performance.getEntriesByType('resource') 里未完成的判断？过度复杂。
  **推荐**：loading = readyState === 'loading' || (readyState === 'interactive' 且有 pending fetch)。实现时以 readyState 为主即可。

## 5. 测试计划（TDD，tests/ 新文件或扩展）

### tests/uid-index.test.ts（新建）
- buildUidIndex：BFS 生成 path、childCount、role/name 正确
- searchIndex：子串匹配、大小写不敏感、排序（name 开头优先）、maxResults
- lookupIndex：命中/未命中

### tests/selector.test.ts（新建，纯函数 buildSelectorFromNode）
- data-testid 优先
- id 唯一时用 #id
- class 组合
- nth-of-type 兜底
- 验证唯一性失败时降级（mock querySelectorAll 返回 >1）

### tests/browser.test.ts（扩展，mock 已有模式）
- attachPageDiagnostics 不重复挂（同 page 调两次，on 只挂一次）
- getPageDiagnostics 返回累积 buffer、clear 清空
- disconnect 后 buffer 清空

### tests/tools.test.ts（扩展，mock browser.ts 模式）
- page_search：匹配/无匹配/索引空报错/maxResults 截断
- get_node：uid 命中输出详情/未命中报错/domState 不可用时降级输出
- element_to_selector：uid 命中输出 selector/未命中报错
- page_status：正常输出 + clear 参数清 buffer

### 真机验证（Hermes 做，不在 Cursor 范围）
- Edge 9223 连真实页面，page_search("登录") 命中、get_node 输出、
  element_to_selector 给官方 click 用、page_status 字段齐全

## 6. 文件改动清单

| 文件 | 动作 |
|------|------|
| src/core/uid-index.ts | 新建（buildUidIndex/searchIndex/lookupIndex + 类型） |
| src/core/selector.ts | 新建（buildSelectorFromNode 纯函数） |
| src/browser.ts | 增加 queryDomByBackendNodeId / elementToSelector / attachPageDiagnostics / getPageDiagnostics / clearPageDiagnostics；getActivePage 或现有快照路径维护 lastActiveUrl |
| src/core/snapshot.ts 或 src/tools/* | 快照成功后 buildUidIndex 刷新内存索引（放 tools 层：smart_snapshot.ts / snapshot_diff.ts 的 handler 末尾调用） |
| src/tools/page_search.ts | 新建 |
| src/tools/get_node.ts | 新建 |
| src/tools/element_to_selector.ts | 新建 |
| src/tools/page_status.ts | 新建 |
| src/index.ts | TOOLS 数组 + CallTool 分支加 4 个新工具 |
| tests/uid-index.test.ts | 新建 |
| tests/selector.test.ts | 新建 |
| tests/browser.test.ts | 扩展 |
| tests/tools.test.ts | 扩展 |

## 7. 提交要求

- 每个逻辑单元一个 commit，message 用 `feat:` 前缀：
  1. `feat: add uid index core (buildUidIndex/searchIndex/lookupIndex)`
  2. `feat: add css selector builder core`
  3. `feat: add browser dom query + diagnostics (queryDomByBackendNodeId / elementToSelector / page diagnostics)`
  4. `feat: add page_search tool`
  5. `feat: add get_node tool`
  6. `feat: add element_to_selector tool`
  7. `feat: add page_status tool`
  8. `feat: register new tools in index + wire uid index refresh`
- 不 commit：CHANGELOG.md、release-please 相关（Hermes 管）
- 不 commit：bench/ 下任何东西（Hermes 管）

## 8. 验收标准（Hermes 验证）

- typecheck 0 错；vitest 全绿（现有 79 + 新增）；prettier/eslint 干净
- 真机：Edge 9223 → 先 smart_snapshot → page_search("登录") 命中 →
  element_to_selector(uid) 返回唯一 selector → get_node 详情完整 →
  page_status 字段齐全
- 5 个新工具在 tools/list 里可见，调用不崩溃

## 9. 备注

- 不要动现有 3 个工具的 schema/行为（除 uid 索引刷新这个追加动作）
- runExclusiveSnapshotTool 只包快照类工具；查询类（page_search/get_node/
  element_to_selector/page_status）不走串行队列，直接并发
- 页面导航后旧索引失效：查询工具对比 lastActiveUrl 提示重快照（实现
  优先级低于核心功能，可最后做；至少 element_to_selector/get_node
  的 DOM 反查失败时要给出友好错误）

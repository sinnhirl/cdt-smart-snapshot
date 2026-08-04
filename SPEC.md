# cdt-smart-snapshot — chrome-devtools-mcp 智能快照压缩 MCP server

## 1. 项目定位

一个独立的 MCP server（TypeScript），专为「登录态网站操作」场景提供 token 高效的页面感知层。
与官方 chrome-devtools-mcp **并行使用**：操作（click/fill/navigate）走官方 full 模式，
页面感知（看状态/找元素/查变化）走本 server 的 3 个工具。

差异化（社区空白点，2026-08 核实）：
- 官方只做了跳过 ignored AX 节点（#635），没做语义级精简
- 官方 8/3 main 分支新增 --slim 模式 = 砍掉快照/点击工具只留 navigate/evaluate/screenshot，是「阉割能力」路线
- 全 GitHub 无「快照 diff 增量」竞品（context-mode 19.6K★ 也没做）
- 本项目的卖点：保留完整操作能力 + 智能快照压缩 + diff 增量

## 2. 技术栈（锁定版本）

- Node.js >= 20.19（用户环境 v22.22.3 ✓）
- TypeScript 5.x，ESM（"type": "module"）
- @modelcontextprotocol/sdk ^1.29（**稳定版 v1**，实现 2025-11-25 spec；不要用 v2 main 分支的 @modelcontextprotocol/server）
- puppeteer-core（**不下载 Chromium**，connect 到已运行的 Edge/Chrome）
- zod（工具 schema 校验）
- vitest（TDD 测试框架）
- eslint 9 flat config + typescript-eslint + @stylistic/eslint-plugin + eslint-plugin-import
- prettier

## 3. 目录结构

```
/mnt/c/code/cdt-smart-snapshot/
├── .cursorrules              # Cursor AI 代码风格强制规则（内容见 §7）
├── AGENTS.md                 # AI 贡献者规则（内容见 §7）
├── .prettierrc.cjs           # prettier 配置（见 §6）
├── eslint.config.mjs         # eslint 9 flat config（见 §6）
├── tsconfig.json             # 严格模式（见 §6）
├── package.json              # ESM, scripts: build/test/typecheck/format
├── README.md                 # 使用文档 + benchmark 表（阶段 6 填）
├── src/
│   ├── index.ts              # MCP server 入口：注册 3 工具 + StdioServerTransport
│   ├── config.ts             # 配置读取（Edge CDP 端口 9222/9223、截图目录、深度限制）
│   ├── browser.ts            # puppeteer-core connect 管理（单例、重连、页面选择）
│   ├── types.ts              # 公共类型（TextSnapshotNode、SnapshotOptions、DiffResult 等）
│   ├── core/
│   │   ├── ax-tree.ts        # 获取 AX 树（page.accessibility.snapshot）→ 标准化节点
│   │   ├── visibility.ts     # 可见性过滤：getBoundingClientRect + display/visibility 判断
│   │   ├── interaction.ts    # 交互性过滤：role 白名单 + 文本节点保留
│   │   ├── dedupe.ts         # 去重：同 role+name 合并计数
│   │   ├── prune.ts          # 深度限制 + 折叠
│   │   ├── snapshot.ts       # smart_snapshot 主流程（四条管线串起来）
│   │   ├── uid.ts            # backendNodeId → uid 稳定映射（跨快照识别同一元素）
│   │   └── diff.ts           # snapshot_diff 增量算法
│   └── tools/
│       ├── smart_snapshot.ts       # 工具 1
│       ├── snapshot_diff.ts        # 工具 2
│       └── screenshot_to_disk.ts   # 工具 3
└── tests/
    ├── visibility.test.ts
    ├── interaction.test.ts
    ├── dedupe.test.ts
    ├── prune.test.ts
    ├── snapshot.test.ts
    ├── uid.test.ts
    ├── diff.test.ts
    └── tools.test.ts         # MCP 工具级集成测试（mock 页面）
```

## 4. 三个工具的详细定义

### 工具 1: smart_snapshot

- **name**: `smart_snapshot`
- **description**: `Returns a token-efficient semantic snapshot of the current page: only visible, interactive and meaningful nodes, with depth limiting and deduplication. Use this instead of take_snapshot to save context.`
- **schema** (zod):
  ```ts
  {
    maxDepth: z.number().int().min(1).max(20).default(8)
      .describe('Maximum tree depth. Deeper subtrees are collapsed into a summary line.'),
    includeHidden: z.boolean().default(false)
      .describe('If true, include offscreen/hidden nodes (useful for debugging). Default false.'),
    verbose: z.boolean().default(false)
      .describe('If true, include container/static nodes too. Default false (interactive + meaningful text only).'),
  }
  ```
- **返回** (text content，纯文本树，形如):
  ```
  [Document] example.com
    [banner] "邮件" [region]
      [button] "写邮件" (uid=12)
      [link] "收件箱" (uid=15)
      [link] "已发送" ×3 (uid=18)
    [main] [region]
      [text] "3 封未读邮件"
      [article] "来自 UCI Admissions" [region]
        [link] "Fall 2026 入学信息" (uid=42)
        [text] "2026-08-01"
  ```
  行格式：`[role] "name" (uid=N)`，同 role+name 合并显示 `×count`。
  深度超过 maxDepth 的子树折叠为一行 `[+] "父节点名" (N 个子节点, uid=M)`。
- **错误**：连不上浏览器 → `{isError: true, content: [{type: "text", text: "Failed to connect to browser at ws://...: <err>"}]}`；无活动页面 → 类似错误。

### 工具 2: snapshot_diff

- **name**: `snapshot_diff`
- **description**: `Returns only the changes between the current page state and the previous smart_snapshot call. Added/removed/changed nodes with a few lines of context. Use this on every step after the first to consume minimal tokens.`
- **schema**:
  ```ts
  {
    maxDepth: z.number().int().min(1).max(20).default(8).describe('Same as smart_snapshot.'),
    includeHidden: z.boolean().default(false).describe('Same as smart_snapshot.'),
  }
  ```
- **行为**：
  1. 首次调用且无历史快照 → 返回完整 smart_snapshot + 提示 `(initial snapshot, no diff available)`
  2. 之后每次调用：取当前 AX 树，与内存中上一次快照做 diff
  3. 用 uid 稳定映射识别同一元素（backendNodeId 变化 → 视为新增+消失）
  4. 返回格式：
  ```
  ── 变化摘要 ──
  + 新增 [link] "开学注册通知" (uid=51)
  - 消失 [link] "加载中" (uid=30)
  ~ 变化 [text] "2 封未读邮件" → "3 封未读邮件" (uid=44)
  ── 上下文 ──
  [main] [region]
    + [link] "开学注册通知" (uid=51)
  ```
  完全相同 → 返回 `(no changes since last snapshot)`
- **内存策略**：只保留最近一次快照；快照含 uid 到节点的映射，供 next 调用对比。server 重启后首个 diff 退化为全量。
- **错误**：同 smart_snapshot。

### 工具 3: screenshot_to_disk

- **name**: `screenshot_to_disk`
- **description**: `Takes a screenshot, saves it to disk, and returns the file path. Saves ~3000-5000 tokens per screenshot compared to returning base64. Read the file with read_file if you need to inspect it.`
- **schema**:
  ```ts
  {
    format: z.enum(['png', 'jpeg']).default('png').describe('Screenshot format.'),
    quality: z.number().int().min(0).max(100).default(80).describe('JPEG quality (ignored for PNG).'),
    fullPage: z.boolean().default(false).describe('If true, capture the full scrollable page.'),
    directory: z.string().optional().describe('Output directory override. Defaults to config screenshotDir (system temp).'),
  }
  ```
- **返回**：`Screenshot saved to: /tmp/cdt-snapshots/20260804_0930_12ab.png`（纯文本一行）
- **文件命名**：`YYYYMMDD_HHMMSS_<6位随机hex>.<ext>`，目录不存在自动创建。

## 5. 核心算法

### 5.1 AX 树获取与标准化 (ax-tree.ts)
- `puppeteer-core` connect（见 §5.5）→ 当前活动 page → `page.accessibility.snapshot({includeIframes: true, interestingOnly: true})`
- 标准化为 `TextSnapshotNode { uid, role, name, value?, backendNodeId?, children: TextSnapshotNode[], visible?: boolean }`
- AX 树节点属性：`role`, `name`, `value`, `backendNodeId`, `children`, `ignored`
- 注意：`interestingOnly: true` 已由 puppeteer 过滤部分 ignored；我们仍要处理返回的节点

### 5.2 可见性过滤 (visibility.ts)
对每个节点执行（用 `page.evaluate` 批量查询 DOM 几何信息）：
- `display: none` / `visibility: hidden` / `opacity: 0`（父级同样算隐藏）→ 隐藏
- `getBoundingClientRect()`：width/height 为 0 → 隐藏
- 视口判断：`rect.top > window.innerHeight || rect.bottom < 0` 等 → offscreen（默认过滤；includeHidden=true 时保留并标记）
- 返回 {visible, offscreen} 二元状态，供过滤与标记

### 5.3 交互性过滤 (interaction.ts)
role 白名单（保留）：
```
button, link, input, checkbox, radio, combobox, textbox, listbox, option,
menuitem, menuitemcheckbox, menuitemradio, tab, switch, slider, spinbutton,
searchbox, dialog, alert, alertdialog, article, heading, table, row, cell,
img (有 name 时), text (非空 name 时), banner, main, navigation, region (有 name)
```
折叠（不输出，仅作容器）：`group, generic, list, listitem, paragraph, statictext, complementary, contentinfo, form, section`
带 `region` 等 landmark 且无 name 时折叠，有 name 时输出。

### 5.4 去重 + 深度 (dedupe.ts / prune.ts)
- 去重：同一父节点下，同 role + 同 name 的连续兄弟节点合并为 `×N`，取第一个 uid 为代表
- 深度：BFS 遍历，depth > maxDepth 的子树折叠为一行 `[+] "name" (N 子节点, uid=M)`

### 5.5 browser.ts 连接管理
- 读取配置：`CDT_WS_ENDPOINT`（优先）或 `CDT_BROWSER_URL`（默认 `http://127.0.0.1:9222`，portproxy 场景用 9223）
- `puppeteer.connect({browserURL})`，单例复用；断线自动重连一次
- 页面选择：取 `browser.pages()` 中最后激活的（`pages.at(-1)`），跳过 `about:blank` 和 devtools 页
- 环境变量：`CDT_SNAPSHOT_DIR`（截图目录，默认 `os.tmpdir()/cdt-snapshots`）

### 5.6 diff 算法 (diff.ts)
输入：prevSnapshot（含 uid→node map）、currSnapshot（同）
```
对 curr 树做 BFS：
  uid 在 prev 中且节点相同（role/name/value 都同）→ skip
  uid 在 prev 中但属性变化 → ~ 变化（列出变化字段）
  uid 不在 prev 中 → + 新增
对 prev 树做 BFS：
  uid 不在 curr 中 → - 消失
```
输出按 DOM 顺序排列：新增/变化按 curr 顺序，消失按 prev 顺序穿插在父级位置。
「节点相同」判断：role、name、value、visible 全部相等。
上下文：diff 行所在父节点的 role/name 行 + 直接子 diff 行（最多 ±2 行缩进上下文）。

## 6. 工程标准（全部抄官方 chrome-devtools-mcp，锁定）

### 6.1 tsconfig.json（严格）
```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "outDir": "./build",
    "rootDir": ".",
    "strict": true,
    "noImplicitReturns": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "incremental": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

### 6.2 eslint.config.mjs（flat config，官方规则子集）
- `typescript-eslint` recommended + stylistic
- `@stylistic/semi: error`、`curly: [error, all]`
- `@typescript-eslint/no-explicit-any: [error, {ignoreRestArgs: true}]`
- `@typescript-eslint/consistent-type-imports: error`
- `@typescript-eslint/consistent-type-definitions: [error, interface]`
- `@typescript-eslint/array-type: [error, {default: array-simple}]`
- `@typescript-eslint/no-floating-promises: error`
- `@typescript-eslint/no-unused-vars: [error, {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}]`
- `import/no-cycle: [error, {maxDepth: Infinity}]`
- 忽略：node_modules、build

### 6.3 .prettierrc.cjs（官方同款）
```js
module.exports = {
  bracketSpacing: false,
  singleQuote: true,
  trailingComma: 'all',
  arrowParens: 'avoid',
  singleAttributePerLine: true,
  endOfLine: 'lf',
};
```

### 6.4 package.json scripts
```json
{
  "type": "module",
  "engines": {"node": "^20.19.0 || ^22.12.0 || >=23"},
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "eslint --fix . && prettier --write .",
    "check-format": "eslint . && prettier --check .",
    "start": "node build/src/index.js"
  }
}
```

## 7. AI 协作规则（.cursorrules 与 AGENTS.md 内容，逐字照抄）

### .cursorrules 内容
```
# cdt-smart-snapshot 项目规则（AI 必须遵守）

## TypeScript 硬性规则（违反 = 重写）
- 禁止使用 any 类型；禁止 as 类型断言；禁止 ! 非空断言
- 禁止 // @ts-ignore、// @ts-nocheck、// @ts-expect-error 注释
- 优先用 for..of 而不是 forEach
- 类型只导入用 import type；形状定义用 interface 优先于 type
- 数组类型用 Array<T> 简单形式（array-simple）

## 注释（本项目强制要求，用户明确要求）
- 每个公共函数/方法必须有 JSDoc 注释：@param、@returns、@throws
- 核心算法（visibility/diff/dedupe）每个函数顶部写「为什么」注释
- 复杂逻辑行内注释解释意图，不要逐行翻译代码

## TDD（铁律）
- 先写测试，看它失败（RED），再写最小实现（GREEN），再重构（REFACTOR）
- 没有失败测试就不写生产代码
- 每个测试命名：shouldXxxWhenYyy 格式

## 提交规范
- Conventional Commits: feat:/fix:/docs:/chore:/refactor:/test:
- 一行标题 ≤ 72 字符

## 质量门
- npm run check-format 必须零报错
- npm run typecheck 必须零报错
- npm run test 必须全绿
```

### AGENTS.md 内容
```
# cdt-smart-snapshot

Token-efficient snapshot MCP server for Chrome DevTools protocol.

## 命令
- npm run build — tsc 编译
- npm run test — vitest 全量测试
- npm run typecheck — 类型检查
- npm run format — eslint+prettier 自动修复
- npm run check-format — 质量门（零报错才能提交）

## TypeScript 规则
- 禁 any、禁 as、禁 !、禁 ts-ignore/ts-nocheck/ts-expect-error
- 优先 for..of；interface 优先于 type；import type 分离
- 所有公共函数必须有 JSDoc

## 架构约束
- src/core/ 只放纯函数（无 puppeteer 依赖，可单测）
- src/tools/ 只放 MCP 工具定义（薄层，调用 core）
- src/browser.ts 是唯一知道 puppeteer 的地方
```

## 8. TDD 测试清单（先写测试，全部覆盖才算 MVP 完成）

tests/visibility.test.ts：
- [ ] shouldMarkDisplayNoneNodeAsHidden
- [ ] shouldMarkVisibilityHiddenNodeAsHidden
- [ ] shouldMarkZeroSizeNodeAsHidden
- [ ] shouldMarkOffscreenNodeAsOffscreenNotHidden
- [ ] shouldMarkInViewportNodeAsVisible

tests/interaction.test.ts：
- [ ] shouldKeepButtonRole
- [ ] shouldKeepLinkRoleWithName
- [ ] shouldKeepInputRole
- [ ] shouldCollapseGenericContainer
- [ ] shouldKeepRegionWithNameAndCollapseWithout
- [ ] shouldKeepTextNodeWithNonEmptyName

tests/dedupe.test.ts：
- [ ] shouldMergeConsecutiveSameRoleNameSiblingsIntoCount
- [ ] shouldNotMergeDifferentRoles
- [ ] shouldKeepFirstUidAsRepresentative

tests/prune.test.ts：
- [ ] shouldCollapseSubtreeBeyondMaxDepth
- [ ] shouldShowCollapsedSummaryWithChildCountAndUid

tests/snapshot.test.ts：
- [ ] shouldProduceFormattedTreeWithRolesNamesUids
- [ ] shouldApplyAllFourPipelinesInOrder
- [ ] shouldIncludeHiddenWhenRequested

tests/uid.test.ts：
- [ ] shouldAssignStableUidFromBackendNodeId
- [ ] shouldReuseUidForSameBackendNodeAcrossSnapshots
- [ ] shouldGenerateFreshUidWhenBackendNodeIdMissing

tests/diff.test.ts：
- [ ] shouldReportAddedNode
- [ ] shouldReportRemovedNode
- [ ] shouldReportChangedName
- [ ] shouldReportChangedValue
- [ ] shouldSkipUnchangedNodes
- [ ] shouldReturnNoChangesMessageWhenIdentical
- [ ] shouldReturnInitialSnapshotOnFirstCall
- [ ] shouldSortOutputByDomOrder

tests/tools.test.ts（mock 页面，不连真实浏览器）：
- [ ] smart_snapshotShouldReturnTextContent
- [ ] smart_snapshotShouldReturnErrorWhenNoPage
- [ ] snapshot_diffShouldReturnInitialOnFirstCall
- [ ] screenshot_to_diskShouldReturnFilePath
- [ ] screenshot_to_diskShouldCreateDirectory

## 9. 验收标准（MVP 完成线）

- [ ] npm run check-format 零报错（eslint + prettier）
- [ ] npm run typecheck 零报错
- [ ] npm run test 全绿（上面全部测试用例通过）
- [ ] 3 个工具通过 MCP 协议正确注册（用 MCP Inspector 或 stdio 冒烟测试验证 tools/list 返回 3 个工具）
- [ ] 代码注释完整（JSDoc 覆盖公共函数，用户要求）
- [ ] .cursorrules + AGENTS.md 已就位
- [ ] README.md 有：安装、MCP 配置示例（Hermes/Claude Code）、工具说明、benchmark 占位表

## 10. 后续阶段（不在本次 MVP）
- 阶段 5：真环境 benchmark（连 Edge 9222，邮箱 30 步会话 token 对比，填 README 表）
- 阶段 6：npm publish + GitHub repo（Apache-2.0）+ LICENSE
- 阶段 7（远期）：带 benchmark 数据去官方 issue #1966 提案

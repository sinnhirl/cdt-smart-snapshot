# cdt-smart-snapshot — token-efficient snapshot MCP server for chrome-devtools-mcp

## 1. Positioning

A standalone MCP server (TypeScript) providing a token-efficient page-perception layer
for "logged-in website operation" workflows. Used **alongside** the official
chrome-devtools-mcp: operations (click/fill/navigate) stay on the official server;
page perception (reading state / finding elements / tracking changes) goes through
this server's 3 tools.

Differentiation (verified community gaps, 2026-08):

- Official only skips ignored AX nodes (#635); no semantic-level pruning
- Official `--slim` mode (main branch, 8/3) drops snapshot/click tools entirely, keeping
  only navigate/evaluate/screenshot — a "strip capability" approach
- No "snapshot diff" competitor anywhere on GitHub (context-mode 19.6K★ doesn't do it)
- This project's value: keep full operation capability + smart snapshot compression + diff deltas

## 2. Tech stack (locked)

- Node.js >= 20.19 (dev env v22.22.3 ✓)
- TypeScript 5.x, ESM ("type": "module")
- @modelcontextprotocol/sdk ^1.29 (**stable v1**, implements 2025-11-25 spec; do NOT use
  the v2 main-branch @modelcontextprotocol/server)
- puppeteer-core (**no Chromium download**; connect to an already-running Edge/Chrome)
- zod (tool schema validation)
- vitest (TDD test framework)
- eslint 9 flat config + typescript-eslint + @stylistic/eslint-plugin + eslint-plugin-import
- prettier

## 3. Directory layout

```
/mnt/c/code/cdt-smart-snapshot/
├── .cursorrules              # Cursor AI code-style enforcement (content in §7)
├── AGENTS.md                 # AI contributor rules (content in §7)
├── .prettierrc.cjs           # prettier config (§6)
├── eslint.config.mjs         # eslint 9 flat config (§6)
├── tsconfig.json             # strict mode (§6)
├── package.json              # ESM; scripts: build/test/typecheck/format
├── README.md                 # usage docs + benchmark table
├── SPEC.md                   # this document
├── bench/                    # end-to-end benchmark scripts (live Edge)
├── src/
│   ├── index.ts              # MCP server entry: registers 3 tools + StdioServerTransport
│   ├── config.ts             # config reading (Edge CDP port 9222/9223, screenshot dir, depth)
│   ├── browser.ts            # puppeteer-core connect management (singleton, retry, page pick)
│   ├── types.ts              # shared types (TextSnapshotNode, SnapshotOptions, DiffResult…)
│   ├── core/
│   │   ├── ax-tree.ts        # AX tree fetch (page.accessibility.snapshot) → normalized nodes
│   │   ├── visibility.ts     # visibility filter: getBoundingClientRect + display/visibility
│   │   ├── interaction.ts    # interaction filter: role whitelist + text retention
│   │   ├── dedupe.ts         # dedupe: same role+name merged into a count
│   │   ├── prune.ts          # depth limiting + collapse
│   │   ├── snapshot.ts       # smart_snapshot pipeline (chained four filters)
│   │   ├── uid.ts            # backendNodeId → uid stable mapping (cross-snapshot identity)
│   │   └── diff.ts           # snapshot_diff incremental algorithm
│   └── tools/
│       ├── smart_snapshot.ts       # tool 1
│       ├── snapshot_diff.ts        # tool 2
│       └── screenshot_to_disk.ts   # tool 3
└── tests/
    ├── visibility.test.ts
    ├── interaction.test.ts
    ├── dedupe.test.ts
    ├── prune.test.ts
    ├── snapshot.test.ts
    ├── uid.test.ts
    ├── diff.test.ts
    └── tools.test.ts         # MCP tool-level integration tests (mocked page)
```

## 4. Tool definitions

### Tool 1: smart_snapshot

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
- **return** (text content, plain-text tree):
  ```
  [Document] example.com
    [banner] "Mail" [region]
      [button] "Compose" (uid=12)
      [link] "Inbox" (uid=15)
      [link] "Sent" ×3 (uid=18)
    [main] [region]
      [text] "3 unread emails"
      [article] "From UCI Admissions" [region]
        [link] "Fall 2026 info" (uid=42)
        [text] "2026-08-01"
  ```
  Line format: `[role] "name" (uid=N)`; same role+name merged shows `×count`.
  Subtrees deeper than maxDepth collapse to `[+] "parent" (N child nodes, uid=M)`.
- **errors**: browser unreachable → `{isError: true, content: [{type: "text", text: "Failed to connect to browser at ws://...: <err>"}]}`; no active page → similar.

### Tool 2: snapshot_diff

- **name**: `snapshot_diff`
- **description**: `Returns only the changes between the current page state and the previous smart_snapshot call. Added/removed/changed nodes with a few lines of context. Use this on every step after the first to consume minimal tokens.`
- **schema**:
  ```ts
  {
    maxDepth: z.number().int().min(1).max(20).optional()
      .describe('Same as smart_snapshot (falls back to CDT_MAX_DEPTH).'),
    includeHidden: z.boolean().default(false).describe('Same as smart_snapshot.'),
    verbose: z.boolean().default(false)
      .describe('Same as smart_snapshot (include container/static nodes too).'),
  }
  ```
- **behavior**:
  1. First call with no history → full smart_snapshot + note `(initial snapshot, no diff available)`
  2. Subsequent calls: fetch current AX tree, diff against the in-memory previous snapshot
  3. Identity via stable uid mapping (backendNodeId churn → reported as remove + add)
  4. Output:
  ```
  -- Changes --
  + added [link] "Registration notice" (uid=51)
  - removed [link] "Loading…" (uid=30)
  ~ changed [text] "2 unread" → "3 unread" (uid=44)
  -- Context --
  [main] [region]
    + [link] "Registration notice" (uid=51)
  ```
  Identical → `(no changes since last snapshot)`
- **memory**: only the latest snapshot is retained (with uid→node map). Server restart
  degrades the first diff to a full snapshot.
- **errors**: same as smart_snapshot.

### Tool 3: screenshot_to_disk

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
- **return**: `Screenshot saved to: /tmp/cdt-snapshots/20260804_0930_12ab.png` (single text line)
- **naming**: `YYYYMMDD_HHMMSS_<6-hex>.<ext>`; directory auto-created.
- **security**: `directory` is resolved and must stay under the configured
  `CDT_SNAPSHOT_DIR` root; paths escaping it (`../../etc`) are rejected.

## 5. Core algorithms

### 5.1 AX tree fetch & normalization (ax-tree.ts)

- puppeteer-core connect (§5.5) → active page → `page.accessibility.snapshot({includeIframes: true, interestingOnly: true})`
- Normalize to `TextSnapshotNode { uid, role, name, value?, backendNodeId?, children, visible? }`
- AX node props: `role`, `name`, `value`, `backendNodeId`, `children`, `ignored`
- Note: `interestingOnly: true` already drops some ignored nodes; remaining nodes still processed
- Identity: nodes with a backendNodeId get a stable uid from `UidMapper`; AX-only
  nodes (no DOM handle) get a logical-path uid keyed by `(parentUid, role, siblingIndex)`
  — deliberately excluding name so text changes diff as `~ changed`, not remove+add.
  Known limitation (documented): inserting an earlier sibling shifts siblingIndex and
  can cascade spurious remove+add for following AX-only nodes; backendNodeId nodes unaffected.
- The mapper grows monotonically for process lifetime (stable diff identity is the
  design goal); reset() exists for tests only.

### 5.2 Visibility filter (visibility.ts)

Per node (batch DOM geometry via page.evaluate):

- `display:none` / `visibility:hidden` / `opacity:0` (inherited from ancestors) → hidden
- `getBoundingClientRect()`: width/height 0 → hidden
- Viewport test: `rect.top > innerHeight || rect.bottom < 0` etc. → offscreen (dropped by default; kept when includeHidden=true, marked)
- Nodes missing from the geometry map are **not** assumed visible (never stamped visible on partial data); when a non-empty map was applied, unevaluated nodes are dropped
- When a parent is hidden, surviving visible descendants are **promoted** to the nearest kept ancestor (single child inlined; multiple wrapped in a `__promoted__` node that formatters flatten) — hidden shells with independently visible controls no longer lose them
- Large pages (node count > `VISIBILITY_MAX_NODES`): per-node collection is skipped; `stampOptimisticDomVisibility` marks nodes with a backendNodeId as visible so real DOM nodes survive while AX-only decoration is dropped (`hideUnevaluated` semantics, V1 behavior preserved)
- Returns {visible, offscreen} binary state for filtering/marking

### 5.3 Interaction filter (interaction.ts)

Role whitelist (keep):

```
button, link, input, checkbox, radio, combobox, textbox, listbox, option,
menuitem, menuitemcheckbox, menuitemradio, tab, switch, slider, spinbutton,
searchbox, dialog, alert, alertdialog, article, heading, table, row, cell,
img (when named), text (when non-empty), banner, main, navigation, region (when named)
```

Collapse (container only, not emitted): `group, generic, list, listitem, paragraph,
statictext, complementary, contentinfo, form, section`. Landmarks (region etc.) collapse
when unnamed, emit when named.

### 5.4 Dedupe + depth (dedupe.ts / prune.ts)

- Dedupe: consecutive siblings with same role+name merge into `×N`; first uid is representative
- Depth: BFS; subtrees deeper than maxDepth collapse to `[+] "name" (N child nodes, uid=M)`

### 5.5 browser.ts connection management

- Config: `CDT_WS_ENDPOINT` (preferred) or `CDT_BROWSER_URL` (default `http://127.0.0.1:9222`; portproxy case 9223)
- `puppeteer.connect({browserURL})`, singleton; one auto-reconnect attempt
- Page pick: last active page in `browser.pages()` (skip about:blank and devtools pages)
- Env: `CDT_SNAPSHOT_DIR` (default `os.tmpdir()/cdt-snapshots`)
- Note (WSL): from WSL, Windows services are reachable via the Windows host IP
  (gateway from `ip route show default`), NOT 127.0.0.1 — e.g. `CDT_BROWSER_URL=http://172.27.64.1:9223`

### 5.6 Diff algorithm (diff.ts)

Input: prevSnapshot (with uid→node map), currSnapshot

```
Sibling-list merge in DOM order (two-pointer over prev/curr children):
  uid in prev and attrs identical (role/name/value/visible/offscreen) → skip
  uid in prev but attrs differ → ~ changed (list changed fields)
  uid not in curr → - removed (interleaved at the parent's sibling position)
  uid not in prev → + added
Recurse into surviving children pairs; trailing prev siblings are removals.
```

Adds/changes/removals all follow DOM order; removals are interleaved at their
parent's position (SPEC §5.6), not batched after adds.

"Identical" = role, name, value, visible, offscreen all equal.
Dedupe display fields (count/collapsed/childCount) are **not** compared — the diff
baseline is the pre-dedupe tree, so those fields are always undefined there.
Context: parent line (role/name) + direct diff lines (±2 indent levels).

## 6. Engineering standards (mirror official chrome-devtools-mcp)

### 6.1 tsconfig.json (strict)

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

### 6.2 eslint.config.mjs (flat config, official rules subset)

- `typescript-eslint` recommended + stylistic
- `@stylistic/semi: error`, `curly: [error, all]`
- `@typescript-eslint/no-explicit-any: [error, {ignoreRestArgs: true}]`
- `@typescript-eslint/consistent-type-imports: error`
- `@typescript-eslint/consistent-type-definitions: [error, interface]`
- `@typescript-eslint/array-type: [error, {default: array-simple}]`
- `@typescript-eslint/no-floating-promises: error`
- `@typescript-eslint/no-unused-vars: [error, {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}]`
- `import/no-cycle: [error, {maxDepth: Infinity}]`
- ignores: node_modules, build

### 6.3 .prettierrc.cjs (official)

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

## 7. AI collaboration rules (.cursorrules + AGENTS.md content, verbatim)

### .cursorrules

```
# cdt-smart-snapshot project rules (AI must comply)

## TypeScript hard rules (violation = rewrite)
- No `any` type; no `as` type assertions; no `!` non-null assertions
- No `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error` comments
- Prefer `for..of` over `forEach`
- Use `import type` for type-only imports; prefer `interface` over `type` for shapes
- Use simple `Array<T>` form (array-simple rule)

## Comments (mandatory — user requirement)
- Every public function/method needs JSDoc: @param, @returns, @throws
- Core algorithms (visibility/diff/dedupe) need a "why" comment at the top of each function
- Inline comments explain intent on complex logic; never translate code line by line

## TDD (iron law)
- Write the test first, watch it fail (RED), then minimal implementation (GREEN), then refactor (REFACTOR)
- No production code without a failing test
- Test naming: shouldXxxWhenYyy format

## Commit conventions
- Conventional Commits: feat:/fix:/docs:/chore:/refactor:/test:
- Title line ≤ 72 chars

## Quality gates
- `npm run check-format` must be zero-error
- `npm run typecheck` must be zero-error
- `npm run test` must be all green

## Project background (read before writing code)
- Positioning: token-efficient perception layer for chrome-devtools-mcp, 3 tools:
  smart_snapshot (semantic snapshot) / snapshot_diff (incremental) / screenshot_to_disk (file path)
- Stack: Node 22 + TypeScript ESM + @modelcontextprotocol/sdk v1 + puppeteer-core + vitest
- Full spec is in SPEC.md — implement per that spec
```

### AGENTS.md

```
# cdt-smart-snapshot

Token-efficient snapshot MCP server for Chrome DevTools Protocol.

## Commands
- npm run build — compile with tsc
- npm run test — run full vitest suite
- npm run typecheck — type checking
- npm run format — auto-fix with eslint + prettier
- npm run check-format — quality gate (must be zero-error before commit)

## TypeScript rules
- No `any`, no `as` casts, no `!` assertions, no `ts-ignore`/`ts-nocheck`/`ts-expect-error`
- Prefer `for..of`; `interface` over `type`; separate `import type`
- Every public function must have JSDoc

## Architecture constraints
- `src/core/` — pure functions only (no puppeteer dependency, unit-testable)
- `src/tools/` — thin MCP tool definitions only (call into core)
- `src/browser.ts` — the only file that knows about puppeteer
```

## 8. TDD test checklist (write tests first; all must pass for MVP)

tests/visibility.test.ts:

- [ ] shouldMarkDisplayNoneNodeAsHidden
- [ ] shouldMarkVisibilityHiddenNodeAsHidden
- [ ] shouldMarkZeroSizeNodeAsHidden
- [ ] shouldMarkOffscreenNodeAsOffscreenNotHidden
- [ ] shouldMarkInViewportNodeAsVisible

tests/interaction.test.ts:

- [ ] shouldKeepButtonRole
- [ ] shouldKeepLinkRoleWithName
- [ ] shouldKeepInputRole
- [ ] shouldCollapseGenericContainer
- [ ] shouldKeepRegionWithNameAndCollapseWithout
- [ ] shouldKeepTextNodeWithNonEmptyName

tests/dedupe.test.ts:

- [ ] shouldMergeConsecutiveSameRoleNameSiblingsIntoCount
- [ ] shouldNotMergeDifferentRoles
- [ ] shouldKeepFirstUidAsRepresentative

tests/prune.test.ts:

- [ ] shouldCollapseSubtreeBeyondMaxDepth
- [ ] shouldShowCollapsedSummaryWithChildCountAndUid

tests/snapshot.test.ts:

- [ ] shouldProduceFormattedTreeWithRolesNamesUids
- [ ] shouldApplyAllFourPipelinesInOrder
- [ ] shouldIncludeHiddenWhenRequested

tests/uid.test.ts:

- [ ] shouldAssignStableUidFromBackendNodeId
- [ ] shouldReuseUidForSameBackendNodeAcrossSnapshots
- [ ] shouldGenerateFreshUidWhenBackendNodeIdMissing

tests/diff.test.ts:

- [ ] shouldReportAddedNode
- [ ] shouldReportRemovedNode
- [ ] shouldReportChangedName
- [ ] shouldReportChangedValue
- [ ] shouldSkipUnchangedNodes
- [ ] shouldReturnNoChangesMessageWhenIdentical
- [ ] shouldReturnInitialSnapshotOnFirstCall
- [ ] shouldSortOutputByDomOrder

tests/tools.test.ts (mock page, no live browser):

- [ ] smart_snapshotShouldReturnTextContent
- [ ] smart_snapshotShouldReturnErrorWhenNoPage
- [ ] snapshot_diffShouldReturnInitialOnFirstCall
- [ ] screenshot_to_diskShouldReturnFilePath
- [ ] screenshot_to_diskShouldCreateDirectory

## 9. Acceptance criteria (MVP done)

- [ ] `npm run check-format` zero-error (eslint + prettier)
- [ ] `npm run typecheck` zero-error
- [ ] `npm run test` all green (all cases above)
- [ ] 3 tools registered via MCP protocol (verify with MCP Inspector or stdio smoke test: tools/list returns 3 tools)
- [ ] Comments complete (JSDoc on public functions; user requirement)
- [ ] .cursorrules + AGENTS.md in place
- [ ] README.md: install, MCP config example (Hermes/Claude Code), tool docs, benchmark table

## 10. Later stages (not in this MVP)

- Stage 5: live-environment benchmark (Edge 9222, 30-step mail session token comparison, fill README table) — done 2026-08-04 (15 sites × 3 rounds, see README)
- ~~Stage 6: npm publish + GitHub repo (Apache-2.0) + LICENSE~~ — done 2026-08-05 (v0.1.3 on npm; release-please + npm-publish automation in CI)
- Stage 7 (far future): take benchmark data to official issue #1966 proposal

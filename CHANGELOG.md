# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.2.0...v0.2.1) (2026-08-05)

### 🚨 重大修复：DOM 查询工具现在真正可用了 (R4-1)

v0.2.0 引入的 `get_node` / `element_to_selector` 存在严重缺陷：**所有 DOM 反查
100% 失败**。原因是 CDP 的 objectId 绑定创建它的 session，原实现在一个 session
里 resolve 节点、又在另一个 session 里读取 DOM，导致 objectId 失效——工具只能
永远降级为 `domState: unavailable`。

v0.2.1 修复：resolve 和读取复用同一个 CDP session。修复后（真机验证）：

- `get_node(uid)` 返回真实的 tagName / cssSelector / rect / visible / textContent
- `element_to_selector(uid)` 能生成唯一 CSS 选择器，可直接喂给官方
  chrome-devtools-mcp 的 click/fill 使用
- `queryDomByBackendNodeId` 补上 session 释放，避免连接泄漏

> 如果你在用 v0.2.0，请升级：`npm install -g cdt-smart-snapshot@latest`

### Bug Fixes

- accurate errors for AX-only nodes in get_node/element_to_selector (R4-longtest) ([7deb2ec](https://github.com/sinnhirl/cdt-smart-snapshot/commit/7deb2ec6458b315db036936d8fff555342c05ed6))
- get_node cssSelector placeholder + page_status format polish (R4-4 R4-5 R4-6) ([62dc629](https://github.com/sinnhirl/cdt-smart-snapshot/commit/62dc629a3419c369c59def92d6f111ad95a45f7f))
- page_search no-match message no longer claims empty index (R4-longtest) ([fd07bd7](https://github.com/sinnhirl/cdt-smart-snapshot/commit/fd07bd7183065acba26aab3d88096252547a7c9b))
- reuse CDP session for DOM lookup so objectId resolves (R4-1) ([36e05f8](https://github.com/sinnhirl/cdt-smart-snapshot/commit/36e05f87808282ff74ab9599b92db05ffb157971))

## [0.2.0](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.7...v0.2.0) (2026-08-05)

### Features

- add browser dom query + diagnostics (queryDomByBackendNodeId / elementToSelector / page diagnostics) ([7e2cbc4](https://github.com/sinnhirl/cdt-smart-snapshot/commit/7e2cbc4187f8977e8820cc23c5aeef0bd641612f))
- add css selector builder core ([9848a5a](https://github.com/sinnhirl/cdt-smart-snapshot/commit/9848a5a066731288d6d8d118ad57b2f6192fdc98))
- add element_to_selector tool ([b1b5944](https://github.com/sinnhirl/cdt-smart-snapshot/commit/b1b5944d5709b9a07b61adafa2c3583617ab7c61))
- add get_node tool ([d4d0966](https://github.com/sinnhirl/cdt-smart-snapshot/commit/d4d0966e0fdccde690b3f269a97b03bbcf541c38))
- add page_search tool ([3b78a0d](https://github.com/sinnhirl/cdt-smart-snapshot/commit/3b78a0d58cb25162eb3cdbc2a033582b574e5b2f))
- add page_status tool ([d73dd54](https://github.com/sinnhirl/cdt-smart-snapshot/commit/d73dd543050c6c6c6446d00d8f694e2c053dba5c))
- add uid index core (buildUidIndex/searchIndex/lookupIndex) ([87b0452](https://github.com/sinnhirl/cdt-smart-snapshot/commit/87b0452855c80afe2b8b715445cc672a7b767ed2))
- register new tools in index + wire uid index refresh ([3a0e441](https://github.com/sinnhirl/cdt-smart-snapshot/commit/3a0e4410d714f82160d8f2f920d236258cd08dd2))

## [0.1.7](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.6...v0.1.7) (2026-08-05)

### Bug Fixes

- keep RootWebArea root line in snapshots (R3A) ([383aea0](https://github.com/sinnhirl/cdt-smart-snapshot/commit/383aea08d12bf3efb117b7dd03589793ca3a0cf8))
- recognize image role + defensive fold + drop dead statictext entry (R3B R3C R3D) ([590c9c0](https://github.com/sinnhirl/cdt-smart-snapshot/commit/590c9c007775da51b064bfa806a00a6c6ca76a3f))

## [0.1.6](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.5...v0.1.6) (2026-08-05)

### Bug Fixes

- fold redundant text children under self-labeling controls (ROUND3-2) ([ed2daf4](https://github.com/sinnhirl/cdt-smart-snapshot/commit/ed2daf4d4e37a6f4c1610a16d8bbb98da10150e7))

## [0.1.5](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.4...v0.1.5) (2026-08-05)

### Bug Fixes

- only stamp interactive roles visible on large-page skip (ROUND3-1) ([673ca54](https://github.com/sinnhirl/cdt-smart-snapshot/commit/673ca546f2b3f09fdb0c88a41900198f4d71a2bd))

## [0.1.4](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.3...v0.1.4) (2026-08-05)

### Bug Fixes

- detect direct run via realpath so npm bin symlink works ([47ede84](https://github.com/sinnhirl/cdt-smart-snapshot/commit/47ede8447f5c666aade8c9b3745f9b54f624b749))

## [0.1.3](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.2...v0.1.3) (2026-08-05)

### Bug Fixes

- browser lifecycle round2 ([#6](https://github.com/sinnhirl/cdt-smart-snapshot/issues/6) [#10](https://github.com/sinnhirl/cdt-smart-snapshot/issues/10) [#11](https://github.com/sinnhirl/cdt-smart-snapshot/issues/11)) ([98f9b2f](https://github.com/sinnhirl/cdt-smart-snapshot/commit/98f9b2f4f88e9852e78b5aeb380d467aae39ff48))
- diff round2 ([#4](https://github.com/sinnhirl/cdt-smart-snapshot/issues/4) [#7](https://github.com/sinnhirl/cdt-smart-snapshot/issues/7) [#8](https://github.com/sinnhirl/cdt-smart-snapshot/issues/8)) ([17d85af](https://github.com/sinnhirl/cdt-smart-snapshot/commit/17d85aff2caf10a7f2fc1f15ea32bc7490bfbc02))
- tools & metadata round2 ([#5](https://github.com/sinnhirl/cdt-smart-snapshot/issues/5) [#9](https://github.com/sinnhirl/cdt-smart-snapshot/issues/9) [#12](https://github.com/sinnhirl/cdt-smart-snapshot/issues/12) [#13](https://github.com/sinnhirl/cdt-smart-snapshot/issues/13) [#14](https://github.com/sinnhirl/cdt-smart-snapshot/issues/14) [#15](https://github.com/sinnhirl/cdt-smart-snapshot/issues/15) [#16](https://github.com/sinnhirl/cdt-smart-snapshot/issues/16)) ([dc0eba0](https://github.com/sinnhirl/cdt-smart-snapshot/commit/dc0eba080cc8f783679ab0753fc8f740b0832329))
- visibility pipeline round2 ([#1](https://github.com/sinnhirl/cdt-smart-snapshot/issues/1)-[#3](https://github.com/sinnhirl/cdt-smart-snapshot/issues/3)) ([700ffe6](https://github.com/sinnhirl/cdt-smart-snapshot/commit/700ffe6008a30a4876c90b20a1ec16ea4d110289))

## [0.1.2](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.1...v0.1.2) (2026-08-05)

### Bug Fixes

- exclude name from logical-path uid key (C1) + wire snapshot_diff to CDT_MAX_DEPTH (B4) ([0d893f5](https://github.com/sinnhirl/cdt-smart-snapshot/commit/0d893f5cf7cd8302297e190ecc34fedf69610182))

## [0.1.1](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.0...v0.1.1) (2026-08-04)

### Bug Fixes

- implement remaining bugfix batch (M2+M6, D1+D2, V1, M5, M1, B1+B2, N1, B4) ([3b2bb52](https://github.com/sinnhirl/cdt-smart-snapshot/commit/3b2bb52ad01f54a0c66bcfbeda51f93a168c00df))
- stable logical-path uid for AX-only nodes (C1) ([42f9a14](https://github.com/sinnhirl/cdt-smart-snapshot/commit/42f9a14a3626541c6535ae89aaa7ac72e749a814))
- use pre-dedupe/collapse tree as diff baseline (C2) ([6677982](https://github.com/sinnhirl/cdt-smart-snapshot/commit/6677982322fb517ba97c6c228f837ac2227eacd9))

## [Unreleased]

### 🐛 Bug Fixes

- Stable logical-path uid for AX-only nodes so diff no longer reports spurious removed+added (C1)
- Use pre-dedupe/collapse tree as diff baseline (C2)
- Include count/collapsed/childCount in diff comparison (M2)
- Text lines now carry uid for diff traceability (M6)
- Dedupe merge requires equal value/visible/offscreen (D1)
- Dedupe keeps siblings with distinct subtrees (D2)
- Large-page visibility skip drops AX-only nodes but keeps real DOM nodes (V1)
- Promoted wrappers resolved to real parent in diff context (M5)
- Reparenting detected via parent-uid comparison (M1)
- Connect mutex dedupe + disconnected listener (B1+B2)
- Collapse protects unnamed interactive children (N1)
- CDT_MAX_DEPTH wired into smart_snapshot handler (B4)

## [0.1.0] - 2026-08-04

### 🚀 Features

- Initial release: token-efficient snapshot MCP server for Chrome DevTools Protocol
- `smart_snapshot`: visible + interactive semantic tree with depth limit, dedupe, same-name chain collapse
- `snapshot_diff`: uid-stable incremental deltas (added / removed / changed)
- `screenshot_to_disk`: screenshot to file path, no base64 in context
- 15-site × 3-round benchmark: 6-97% token reduction by page type

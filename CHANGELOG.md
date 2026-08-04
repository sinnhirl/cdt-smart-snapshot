# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.3...v0.1.4) (2026-08-05)


### Bug Fixes

* detect direct run via realpath so npm bin symlink works ([47ede84](https://github.com/sinnhirl/cdt-smart-snapshot/commit/47ede8447f5c666aade8c9b3745f9b54f624b749))

## [0.1.3](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.2...v0.1.3) (2026-08-05)


### Bug Fixes

* browser lifecycle round2 ([#6](https://github.com/sinnhirl/cdt-smart-snapshot/issues/6) [#10](https://github.com/sinnhirl/cdt-smart-snapshot/issues/10) [#11](https://github.com/sinnhirl/cdt-smart-snapshot/issues/11)) ([98f9b2f](https://github.com/sinnhirl/cdt-smart-snapshot/commit/98f9b2f4f88e9852e78b5aeb380d467aae39ff48))
* diff round2 ([#4](https://github.com/sinnhirl/cdt-smart-snapshot/issues/4) [#7](https://github.com/sinnhirl/cdt-smart-snapshot/issues/7) [#8](https://github.com/sinnhirl/cdt-smart-snapshot/issues/8)) ([17d85af](https://github.com/sinnhirl/cdt-smart-snapshot/commit/17d85aff2caf10a7f2fc1f15ea32bc7490bfbc02))
* tools & metadata round2 ([#5](https://github.com/sinnhirl/cdt-smart-snapshot/issues/5) [#9](https://github.com/sinnhirl/cdt-smart-snapshot/issues/9) [#12](https://github.com/sinnhirl/cdt-smart-snapshot/issues/12) [#13](https://github.com/sinnhirl/cdt-smart-snapshot/issues/13) [#14](https://github.com/sinnhirl/cdt-smart-snapshot/issues/14) [#15](https://github.com/sinnhirl/cdt-smart-snapshot/issues/15) [#16](https://github.com/sinnhirl/cdt-smart-snapshot/issues/16)) ([dc0eba0](https://github.com/sinnhirl/cdt-smart-snapshot/commit/dc0eba080cc8f783679ab0753fc8f740b0832329))
* visibility pipeline round2 ([#1](https://github.com/sinnhirl/cdt-smart-snapshot/issues/1)-[#3](https://github.com/sinnhirl/cdt-smart-snapshot/issues/3)) ([700ffe6](https://github.com/sinnhirl/cdt-smart-snapshot/commit/700ffe6008a30a4876c90b20a1ec16ea4d110289))

## [0.1.2](https://github.com/sinnhirl/cdt-smart-snapshot/compare/v0.1.1...v0.1.2) (2026-08-05)


### Bug Fixes

* exclude name from logical-path uid key (C1) + wire snapshot_diff to CDT_MAX_DEPTH (B4) ([0d893f5](https://github.com/sinnhirl/cdt-smart-snapshot/commit/0d893f5cf7cd8302297e190ecc34fedf69610182))

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

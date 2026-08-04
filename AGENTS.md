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

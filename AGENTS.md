# cdt-smart-snapshot

Token-efficient snapshot MCP server for Chrome DevTools Protocol.

## Commands

- `npm run build` — compile with tsc
- `npm run test` — run full vitest suite
- `npm run typecheck` — type checking
- `npm run format` — auto-fix with eslint + prettier
- `npm run check-format` — quality gate (must be zero-error before commit)

## TypeScript rules

- No `any`, no `as` casts, no `!` assertions, no `ts-ignore`/`ts-nocheck`/`ts-expect-error`
- Prefer `for..of`; `interface` over `type`; separate `import type`
- Every public function must have JSDoc

## Architecture constraints

- `src/core/` — pure functions only (no puppeteer dependency, unit-testable)
- `src/tools/` — thin MCP tool definitions only (call into core)
- `src/browser.ts` — the only file that knows about puppeteer

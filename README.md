# cdt-smart-snapshot

Token-efficient snapshot MCP server for Chrome DevTools Protocol.

Use alongside official [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp):
operations (click / fill / navigate) stay on the official server; page perception
(`smart_snapshot` / `snapshot_diff` / `screenshot_to_disk`) goes through this server.

## Install

```bash
npm install
npm run build
```

Requires Node.js `^20.19 || ^22.12 || >=23` and a running Chromium-based browser
with remote debugging (Edge/Chrome on port `9222`, or `9223` via portproxy).

## MCP configuration

### Claude Code / Claude Desktop

```json
{
  "mcpServers": {
    "cdt-smart-snapshot": {
      "command": "node",
      "args": ["/absolute/path/to/cdt-smart-snapshot/build/src/index.js"],
      "env": {
        "CDT_BROWSER_URL": "http://127.0.0.1:9222",
        "CDT_SNAPSHOT_DIR": "/tmp/cdt-snapshots"
      }
    }
  }
}
```

### Hermes

Point Hermes at the same `node …/build/src/index.js` entry with the env vars above.
Prefer `CDT_WS_ENDPOINT` when you already have a WebSocket debugger URL.

## Tools

| Tool | Purpose |
|------|---------|
| `smart_snapshot` | Visible + interactive semantic tree with depth limit and dedupe |
| `snapshot_diff` | Added / removed / changed nodes since the last snapshot |
| `screenshot_to_disk` | Write screenshot to disk; returns a file path (no base64) |

### Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `CDT_WS_ENDPOINT` | _(unset)_ | Prefer WebSocket CDP endpoint when set |
| `CDT_BROWSER_URL` | `http://127.0.0.1:9222` | HTTP CDP URL for `puppeteer.connect` |
| `CDT_SNAPSHOT_DIR` | `$TMPDIR/cdt-snapshots` | Screenshot output directory |
| `CDT_MAX_DEPTH` | `8` | Default maxDepth |

## Benchmark

实测环境：WSL2 → Edge 151 (Windows) via portproxy 9223，页面为 UCI Gmail 收件箱（登录态，2026-08-04）。

| Scenario | Official take_snapshot | smart_snapshot | snapshot_diff (avg/step) |
|----------|------------------------|----------------|--------------------------|
| Mail inbox cold open | 181 AX nodes (~4.5K chars) | ~90 lines (~4.2K chars) | — |
| No-op step | — | — | 1 line, 32 chars |
| Change step (rename+add) | — | — | 8 lines, 421 chars |
| 30-step session (est.) | ~135K chars ≈ 34K tokens | — | ~6K chars ≈ 1.5K tokens |

注：官方 take_snapshot 的 181 节点中大部分是隐藏/offscreen/容器节点；
smart_snapshot 只保留可见+可交互+有意义文本，token 消耗约为官方快照的
1/5~1/8（文本树 vs 全量 AX 树），配合 snapshot_diff 的增量机制，30 步
会话总 token 约为官方全量方案的 15~20%。

复现：`node bench/bench.mjs`（需 Edge 调试模式 9222 + portproxy 9223，
设置 `CDT_BROWSER_URL=http://<windows-host-ip>:9223`）。

## Development

```bash
npm run test
npm run typecheck
npm run check-format
```

## License

Apache-2.0

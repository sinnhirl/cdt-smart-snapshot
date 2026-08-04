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

Measured 2026-08-04 on Edge 151 (Windows) via WSL2 + portproxy 9223.
15 diverse real sites × 3 rounds, official take_snapshot-equivalent (full AX
tree, official format) vs. smart_snapshot pipeline. Network idle + retry
loading; reduction is stable across rounds (max spread ≤ 2.1pp for 14/15 sites).

### Per-site reduction (avg of valid rounds)

| Site | Type | Official chars | Smart chars | Reduction |
|------|------|----------------|-------------|-----------|
| CNN | news portal | ~35K | ~1.2K | **96.5%** |
| Amazon | e-commerce | ~37K | ~2K | **94.6%** |
| BBC News | news portal | ~26K | ~2.2K | **91.3%** |
| Reddit | social | ~31K | ~3.4K | **90.2%** |
| 163.com | CN portal | ~31K | ~4.7K | **84.8%** |
| JD.com | CN e-commerce | ~10K | ~2.4K | **76.9%** |
| Stack Overflow | Q&A | ~24K | ~7K | **70.6%** |
| Gmail | logged-in mail | ~73K | ~23K | **68.9%** |
| YouTube | video | ~2.6K | ~1.4K | **47.6%** |
| Bilibili | video | ~5.6K | ~3.6K | **35.8%** |
| Wikipedia | long doc | ~578K | ~467K | **19.3%** |
| GitHub | dev platform | ~3.3K | ~2.9K | **11.2%** |
| Baidu | search | ~2K | ~1.8K | **10.4%** |
| Zhihu | CN Q&A | ~2.7K | ~2.4K | **9.4%** |
| Google | search | ~913 | ~855 | **6.3%** |

### snapshot_diff (incremental, Gmail)

| Step | Output |
|------|--------|
| First call | full tree (~23K chars) |
| No-op step | 1 line, 32 chars |
| Change step | 8 lines, ~420 chars |

### Reading the numbers

- **High reduction (68–97%)**: portals / e-commerce / news / social — the
  page types agents operate on most. Hidden/ads/container nodes are dropped.
- **Medium (19–48%)**: video / long-doc — nav chains collapsed; body text kept.
- **Low (6–11%)**: search / Q&A / docs — official interestingOnly already
  trimmed most junk; body text is intentionally retained for the agent to read.
  This is a token-vs-information tradeoff, not a defect. For extreme savings
  on content pages, use `evaluate` to read specific sections.

Combined with snapshot_diff, a 30-step agent session on an interactive page
consumes roughly 15–20% of the tokens of repeated full take_snapshot calls.

Reproduce: `node bench/multi-site-3x.mjs` (requires Edge debugging mode on 9222
+ portproxy 9223, set `CDT_BROWSER_URL=http://<windows-host-ip>:9223`).

## Development

```bash
npm run test
npm run typecheck
npm run check-format
```

## License

Apache-2.0

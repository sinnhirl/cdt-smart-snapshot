#!/usr/bin/env node
/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MCP server entry: registers smart_snapshot, snapshot_diff, screenshot_to_disk.
 */

import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  handleScreenshotToDisk,
  screenshotToDiskDefinition,
} from './tools/screenshot_to_disk.js';
import {
  handleSmartSnapshot,
  smartSnapshotDefinition,
} from './tools/smart_snapshot.js';
import {
  handleSnapshotDiff,
  snapshotDiffDefinition,
} from './tools/snapshot_diff.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {ToolTextResult} from './types.js';
import {readPackageVersion} from './version.js';

const TOOLS = [
  smartSnapshotDefinition,
  snapshotDiffDefinition,
  screenshotToDiskDefinition,
];

/**
 * Adapts our internal ToolTextResult to the SDK's CallToolResult shape.
 * The SDK type carries a loose index signature; we build an explicit object
 * so assignment stays type-safe without assertions.
 *
 * @param result - Internal tool result.
 * @returns SDK-compatible call result.
 * @throws Never throws.
 */
function toCallToolResult(result: ToolTextResult): CallToolResult {
  return {
    content: result.content,
    isError: result.isError === undefined ? undefined : result.isError,
  };
}

/**
 * Creates and configures the MCP Server with the three snapshot tools.
 *
 * @returns Configured Server instance (not yet connected to a transport).
 * @throws Never throws during construction.
 */
export function createServer(): Server {
  const server = new Server(
    {name: 'cdt-smart-snapshot', version: readPackageVersion()},
    {capabilities: {tools: {}}},
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {tools: [...TOOLS]};
  });

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name;
    const args = request.params.arguments;
    const safeArgs: Record<string, unknown> | undefined =
      args === undefined ? undefined : {...args};

    let result: ToolTextResult;
    if (name === 'smart_snapshot') {
      result = await handleSmartSnapshot(safeArgs);
    } else if (name === 'snapshot_diff') {
      result = await handleSnapshotDiff(safeArgs);
    } else if (name === 'screenshot_to_disk') {
      result = await handleScreenshotToDisk(safeArgs);
    } else {
      result = {
        content: [{type: 'text', text: `Unknown tool: ${name}`}],
        isError: true,
      };
    }

    return toCallToolResult(result);
  });

  return server;
}

/**
 * Starts the MCP server on stdio transport.
 *
 * @returns Resolves when the transport closes.
 * @throws When transport connection fails.
 */
export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Detects direct execution (node index.js or an npm bin symlink to it).
 *
 * Why: process.argv[1] alone is unreliable — npm global installs expose the
 * bin as a symlink whose name is the package command (e.g. cdt-smart-snapshot),
 * so an endsWith('index.js') check silently skips main() and the server exits.
 * Resolving argv[1] to its real path and comparing against this module's URL
 * covers both direct runs and symlinked bin invocations.
 */
function isDirectRun(): boolean {
  const arg1 = process.argv[1];
  if (arg1 === undefined) {
    return false;
  }
  try {
    const real = realpathSync(arg1);
    return import.meta.url === pathToFileURL(real).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  });
}

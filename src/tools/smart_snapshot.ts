/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * smart_snapshot MCP tool — token-efficient semantic page snapshot.
 */

import {z} from 'zod';

import {
  fetchAxTreeWithVisibility,
  getActivePage,
  getLastConnectError,
} from '../browser.js';
import {loadConfig} from '../config.js';
import {normalizeAxTree} from '../core/ax-tree.js';
import {storeSnapshot} from '../core/diff.js';
import {runSmartSnapshotPipeline} from '../core/snapshot.js';
import {defaultUidMapper} from '../core/uid.js';
import type {SnapshotOptions, ToolTextResult} from '../types.js';
import {
  errorResult,
  remapVisibilityToUid,
  textResult,
  toErrorMessage,
  type ToolDefinition,
} from './helpers.js';
import {runExclusiveSnapshotTool} from './snapshot-serial.js';
import {refreshSnapshotUidIndex} from './snapshot-uid-cache.js';

/** Zod schema for smart_snapshot arguments. */
export const smartSnapshotArgsSchema = z.object({
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Maximum tree depth. Deeper subtrees are collapsed into a summary line.',
    ),
  includeHidden: z
    .boolean()
    .default(false)
    .describe(
      'If true, include offscreen/hidden nodes (useful for debugging). Default false.',
    ),
  verbose: z
    .boolean()
    .default(false)
    .describe(
      'If true, include container/static nodes too. Default false (interactive + meaningful text only).',
    ),
});

/** Tool metadata for tools/list. */
export const smartSnapshotDefinition: ToolDefinition = {
  name: 'smart_snapshot',
  description:
    'Returns a token-efficient semantic snapshot of the current page: only visible, interactive and meaningful nodes, with depth limiting and deduplication. Use this instead of take_snapshot to save context.',
  inputSchema: {
    type: 'object',
    properties: {
      maxDepth: {
        type: 'number',
        description:
          'Maximum tree depth. Deeper subtrees are collapsed into a summary line.',
        minimum: 1,
        maximum: 20,
        default: 8,
      },
      includeHidden: {
        type: 'boolean',
        description:
          'If true, include offscreen/hidden nodes (useful for debugging). Default false.',
        default: false,
      },
      verbose: {
        type: 'boolean',
        description:
          'If true, include container/static nodes too. Default false (interactive + meaningful text only).',
        default: false,
      },
    },
  },
};

/**
 * Executes smart_snapshot against the active browser page.
 *
 * @param args - Raw tool arguments (validated via zod).
 * @returns MCP text result (or isError on failure).
 * @throws Never throws — errors are returned as isError results.
 */
export async function handleSmartSnapshot(
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  return runExclusiveSnapshotTool(async () => {
    try {
      const parsed = smartSnapshotArgsSchema.parse(args ?? {});
      const config = loadConfig();
      const options: SnapshotOptions = {
        maxDepth: parsed.maxDepth ?? config.defaultMaxDepth,
        includeHidden: parsed.includeHidden,
        verbose: parsed.verbose,
      };

      const {page, url} = await getActivePage();
      const {raw, visibilityByBackendId, visibilitySkipped} =
        await fetchAxTreeWithVisibility(page);
      const normalized = normalizeAxTree(raw, defaultUidMapper);
      const visibilityByUid = remapVisibilityToUid(
        normalized,
        visibilityByBackendId,
      );
      const result = runSmartSnapshotPipeline(
        normalized,
        options,
        visibilityByUid.size > 0 ? visibilityByUid : undefined,
        visibilitySkipped,
      );

      // Keep diff baseline in sync when agents use smart_snapshot as the first look.
      // Use the pre-dedupe/collapse tree so merged/folded uids stay identifiable.
      storeSnapshot(result.diffRoot, result.formatted);
      refreshSnapshotUidIndex(result.diffRoot, url);
      return textResult(result.formatted);
    } catch (err) {
      const last = getLastConnectError();
      if (last !== undefined) {
        return errorResult(last);
      }
      return errorResult(toErrorMessage(err));
    }
  });
}

/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * snapshot_diff MCP tool — incremental changes since the last snapshot.
 */

import {z} from 'zod';

import {
  fetchAxTreeWithVisibility,
  getActivePage,
  getLastConnectError,
} from '../browser.js';
import {loadConfig} from '../config.js';
import {normalizeAxTree} from '../core/ax-tree.js';
import {runSnapshotDiff} from '../core/diff.js';
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

/** Zod schema for snapshot_diff arguments. */
export const snapshotDiffArgsSchema = z.object({
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Same as smart_snapshot (falls back to CDT_MAX_DEPTH).'),
  includeHidden: z.boolean().default(false).describe('Same as smart_snapshot.'),
  verbose: z
    .boolean()
    .default(false)
    .describe('Same as smart_snapshot (include container/static nodes).'),
});

/** Tool metadata for tools/list. */
export const snapshotDiffDefinition: ToolDefinition = {
  name: 'snapshot_diff',
  description:
    'Returns only the changes between the current page state and the previous smart_snapshot call. Added/removed/changed nodes with a few lines of context. Use this on every step after the first to consume minimal tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      maxDepth: {
        type: 'number',
        description: 'Same as smart_snapshot.',
        minimum: 1,
        maximum: 20,
        default: 8,
      },
      includeHidden: {
        type: 'boolean',
        description: 'Same as smart_snapshot.',
        default: false,
      },
      verbose: {
        type: 'boolean',
        description: 'Same as smart_snapshot.',
        default: false,
      },
    },
  },
};

/**
 * Executes snapshot_diff against the active browser page.
 *
 * @param args - Raw tool arguments (validated via zod).
 * @returns MCP text result (full snapshot on first call, then diffs).
 * @throws Never throws — errors are returned as isError results.
 */
export async function handleSnapshotDiff(
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  return runExclusiveSnapshotTool(async () => {
    try {
      const parsed = snapshotDiffArgsSchema.parse(args ?? {});
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
      // Diff against the pre-dedupe/collapse tree (see diffRoot doc): merged and
      // folded uids remain stable across snapshots, avoiding spurious ± entries.
      const text = runSnapshotDiff(result.diffRoot, result.formatted);
      refreshSnapshotUidIndex(result.diffRoot, url);
      return textResult(text);
    } catch (err) {
      const last = getLastConnectError();
      if (last !== undefined) {
        return errorResult(last);
      }
      return errorResult(toErrorMessage(err));
    }
  });
}

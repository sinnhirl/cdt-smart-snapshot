/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * snapshot_diff MCP tool — incremental changes since the last snapshot.
 */

import {z} from 'zod';

import {fetchAxTreeWithVisibility, getActivePage} from '../browser.js';
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

/** Zod schema for snapshot_diff arguments. */
export const snapshotDiffArgsSchema = z.object({
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe('Same as smart_snapshot.'),
  includeHidden: z.boolean().default(false).describe('Same as smart_snapshot.'),
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
  try {
    const parsed = snapshotDiffArgsSchema.parse(args ?? {});
    const options: SnapshotOptions = {
      maxDepth: parsed.maxDepth,
      includeHidden: parsed.includeHidden,
      verbose: false,
    };

    const {page} = await getActivePage();
    const {raw, visibilityByBackendId} = await fetchAxTreeWithVisibility(page);
    const normalized = normalizeAxTree(raw, defaultUidMapper);
    const visibilityByUid = remapVisibilityToUid(
      normalized,
      visibilityByBackendId,
    );
    const result = runSmartSnapshotPipeline(
      normalized,
      options,
      visibilityByUid,
    );
    const text = runSnapshotDiff(result.root, result.formatted);
    return textResult(text);
  } catch (err) {
    return errorResult(toErrorMessage(err));
  }
}

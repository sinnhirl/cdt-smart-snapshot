/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * snapshot_index MCP tool — list uids from the last snapshot for exploration.
 */

import {z} from 'zod';

import {getActivePage, getLastConnectError} from '../browser.js';
import type {UidIndexEntry} from '../core/uid-index.js';
import type {ToolTextResult} from '../types.js';
import {
  errorResult,
  textResult,
  toErrorMessage,
  type ToolDefinition,
} from './helpers.js';
import {
  formatEntryName,
  isToolError,
  requireSnapshotUidIndex,
} from './query-helpers.js';

/** Zod schema for snapshot_index arguments. */
export const snapshotIndexArgsSchema = z.object({
  maxResults: z.number().int().min(1).max(500).default(100),
});

/** Tool metadata for tools/list. */
export const snapshotIndexDefinition: ToolDefinition = {
  name: 'snapshot_index',
  description:
    'List uids from the most recent snapshot (role, name, path). Useful before page_search or get_node. Requires smart_snapshot or snapshot_diff first.',
  inputSchema: {
    type: 'object',
    properties: {
      maxResults: {
        type: 'number',
        description: 'Maximum rows to list (1–500).',
        minimum: 1,
        maximum: 500,
        default: 100,
      },
    },
  },
};

/**
 * Sorts index entries by uid for stable listing.
 *
 * @param entries - Index values.
 * @returns Sorted copy.
 */
function sortByUid(entries: UidIndexEntry[]): UidIndexEntry[] {
  const copy = [...entries];
  copy.sort((a, b) => a.uid - b.uid);
  return copy;
}

/**
 * Executes snapshot_index against the cached uid map.
 *
 * @param args - Raw tool arguments.
 * @returns MCP text result.
 * @throws Never throws — errors are returned as isError results.
 */
export async function handleSnapshotIndex(
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  try {
    const parsed = snapshotIndexArgsSchema.parse(args ?? {});
    const {url} = await getActivePage();
    const cacheOrError = requireSnapshotUidIndex(url);
    if (isToolError(cacheOrError)) {
      return cacheOrError;
    }

    const all = sortByUid([...cacheOrError.index.values()]);
    const slice = all.slice(0, parsed.maxResults);
    const lines: string[] = [
      `Snapshot index (${String(slice.length)} of ${String(all.length)} nodes) for ${cacheOrError.snapshotUrl}:`,
    ];
    for (const entry of slice) {
      const namePart = formatEntryName(entry);
      const nameDisplay = namePart.length > 0 ? ` ${namePart}` : '';
      lines.push(
        `uid=${String(entry.uid)} [${entry.role}]${nameDisplay} — ${entry.path}`,
      );
    }
    const remaining = all.length - slice.length;
    if (remaining > 0) {
      lines.push(`... and ${String(remaining)} more`);
    }
    return textResult(lines.join('\n'));
  } catch (err) {
    const last = getLastConnectError();
    if (last !== undefined) {
      return errorResult(last);
    }
    return errorResult(toErrorMessage(err));
  }
}

/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * page_search MCP tool — search the last snapshot uid index by keyword.
 */

import {z} from 'zod';

import {getActivePage, getLastConnectError} from '../browser.js';
import {searchIndex} from '../core/uid-index.js';
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

/** Zod schema for page_search arguments. */
export const pageSearchArgsSchema = z.object({
  keyword: z.string().min(1),
  maxResults: z.number().int().min(1).max(100).default(20),
});

/** Tool metadata for tools/list. */
export const pageSearchDefinition: ToolDefinition = {
  name: 'page_search',
  description:
    'Search the most recent smart_snapshot tree for a keyword. Returns matching uids with role, name, and path. Call smart_snapshot or snapshot_diff first.',
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          'Case-insensitive substring to match against name, value, or path.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum matches to return (1–100).',
        minimum: 1,
        maximum: 100,
        default: 20,
      },
    },
    required: ['keyword'],
  },
};

/**
 * Executes page_search against the cached uid index.
 *
 * @param args - Raw tool arguments.
 * @returns MCP text result.
 * @throws Never throws — errors are returned as isError results.
 */
export async function handlePageSearch(
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  try {
    const parsed = pageSearchArgsSchema.parse(args ?? {});
    const {url} = await getActivePage();
    const cacheOrError = requireSnapshotUidIndex(url);
    if (isToolError(cacheOrError)) {
      return cacheOrError;
    }

    const allMatches = searchIndex(
      cacheOrError.index,
      parsed.keyword,
      Number.MAX_SAFE_INTEGER,
    );
    const hits = searchIndex(
      cacheOrError.index,
      parsed.keyword,
      parsed.maxResults,
    );

    if (hits.length === 0) {
      // Index is non-empty here (requireSnapshotUidIndex returned it); the
      // keyword simply matched nothing. Don't tell the user to snapshot again.
      return textResult(
        `No matches for "${parsed.keyword}" in the current snapshot.`,
      );
    }

    const lines: string[] = [
      `Found ${String(hits.length)} matches for "${parsed.keyword}":`,
    ];
    for (let i = 0; i < hits.length; i++) {
      const entry = hits[i];
      if (entry === undefined) {
        continue;
      }
      const namePart = formatEntryName(entry);
      const nameDisplay = namePart.length > 0 ? ` ${namePart}` : '';
      lines.push(
        `${String(i + 1)}. [${entry.role}]${nameDisplay} (uid=${String(entry.uid)}) — ${entry.path}`,
      );
    }
    const remaining = allMatches.length - hits.length;
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

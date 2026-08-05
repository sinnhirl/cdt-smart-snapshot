/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Shared validation for uid query tools.
 */

import type {ToolTextResult} from '../types.js';
import {errorResult} from './helpers.js';
import {
  getSnapshotUidCache,
  type SnapshotUidCache,
} from './snapshot-uid-cache.js';

/**
 * Ensures a snapshot index exists and matches the active page URL.
 *
 * @param currentUrl - URL from getActivePage.
 * @returns Cache or an error result for the tool handler.
 * @throws Never throws.
 */
export function requireSnapshotUidIndex(
  currentUrl: string,
): SnapshotUidCache | ToolTextResult {
  const cache = getSnapshotUidCache();
  if (cache === undefined || cache.index.size === 0) {
    return errorResult(
      'No snapshot yet. Call smart_snapshot or snapshot_diff first.',
    );
  }
  if (cache.snapshotUrl !== currentUrl) {
    return errorResult(
      'Page has navigated since the last snapshot. Call smart_snapshot or snapshot_diff again.',
    );
  }
  return cache;
}

/**
 * Type guard: result is an error tool result.
 *
 * @param value - Cache or error.
 * @returns True when value is ToolTextResult error.
 */
export function isToolError(
  value: SnapshotUidCache | ToolTextResult,
): value is ToolTextResult {
  return !('index' in value);
}

/**
 * Formats a uid index entry name for display.
 *
 * @param entry - Index row.
 * @returns Quoted name or empty.
 */
export function formatEntryName(entry: {
  name: string;
}): string {
  if (entry.name.length > 0) {
    return `"${entry.name}"`;
  }
  return '';
}

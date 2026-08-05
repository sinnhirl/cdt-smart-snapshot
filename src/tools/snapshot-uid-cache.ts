/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * In-memory uid index refreshed after each successful snapshot (tools layer).
 */

import {buildUidIndex} from '../core/uid-index.js';
import type {UidIndexEntry} from '../core/uid-index.js';
import type {TextSnapshotNode} from '../types.js';

/**
 * Cached index plus the page URL when the snapshot was taken.
 */
export interface SnapshotUidCache {
  index: Map<number, UidIndexEntry>;
  snapshotUrl: string;
}

let cache: SnapshotUidCache | undefined;

/**
 * Rebuilds the uid index from a diffRoot after smart_snapshot / snapshot_diff.
 *
 * @param root - Pre-dedupe tree (stable uids).
 * @param snapshotUrl - Active page URL at snapshot time.
 * @returns void
 * @throws Never throws.
 */
export function refreshSnapshotUidIndex(
  root: TextSnapshotNode,
  snapshotUrl: string,
): void {
  cache = {
    index: buildUidIndex(root),
    snapshotUrl,
  };
}

/**
 * Returns the cached index when present.
 *
 * @returns Cache or undefined before any snapshot.
 * @throws Never throws.
 */
export function getSnapshotUidCache(): SnapshotUidCache | undefined {
  return cache;
}

/**
 * Clears the cached index (tests / disconnect).
 *
 * @returns void
 * @throws Never throws.
 */
export function clearSnapshotUidCache(): void {
  cache = undefined;
}

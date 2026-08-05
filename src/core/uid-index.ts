/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Pure uid → node metadata index for query tools (page_search, get_node, etc.).
 *
 * Why: Agents need to find elements by text and resolve uids without re-fetching
 * the full AX tree; BFS over the last diffRoot keeps uids aligned with snapshots.
 */

import type {TextSnapshotNode} from '../types.js';

/**
 * One row in the searchable uid index (paths + AX fields from the snapshot tree).
 */
export interface UidIndexEntry {
  uid: number;
  backendNodeId?: number;
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  placeholder?: string;
  /** Role/name chain from root, e.g. `main > button "Go"`. */
  path: string;
  childCount: number;
}

/**
 * Formats one node as a path segment (role only when name is empty).
 *
 * @param node - Snapshot node.
 * @returns Segment such as `button "Go"` or `main`.
 */
function pathSegment(node: TextSnapshotNode): string {
  if (node.name.length > 0) {
    return `${node.role} "${node.name}"`;
  }
  return node.role;
}

/**
 * BFS over the snapshot tree, flattening synthetic __promoted__ wrappers.
 *
 * Why: Interaction/visibility filters wrap promoted siblings in __promoted__ nodes;
 * query paths should match what agents see in formatted snapshots (no wrapper role).
 *
 * @param root - Pre-dedupe diffRoot from the last snapshot.
 * @returns Map keyed by uid.
 * @throws Never throws.
 */
export function buildUidIndex(root: TextSnapshotNode): Map<number, UidIndexEntry> {
  const index = new Map<number, UidIndexEntry>();
  const queue: Array<{node: TextSnapshotNode; pathPrefix: string}> = [
    {node: root, pathPrefix: ''},
  ];

  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) {
      break;
    }
    const {node, pathPrefix} = item;

    if (node.role === '__promoted__') {
      for (const child of node.children) {
        queue.push({node: child, pathPrefix});
      }
      continue;
    }

    const segment = pathSegment(node);
    const path =
      pathPrefix.length > 0 ? `${pathPrefix} > ${segment}` : segment;

    const entry: UidIndexEntry = {
      uid: node.uid,
      role: node.role,
      name: node.name,
      path,
      childCount: node.children.length,
    };
    if (node.backendNodeId !== undefined) {
      entry.backendNodeId = node.backendNodeId;
    }
    if (node.value !== undefined) {
      entry.value = node.value;
    }
    index.set(node.uid, entry);

    for (const child of node.children) {
      queue.push({node: child, pathPrefix: path});
    }
  }

  return index;
}

/**
 * Ranking for search hits (lower = better).
 */
interface ScoredEntry {
  entry: UidIndexEntry;
  rank: number;
}

/**
 * Returns a match rank for keyword against one entry, or undefined when no match.
 *
 * @param entry - Index row.
 * @param keywordLower - Already lowercased keyword.
 * @returns Rank 0–3 or undefined.
 */
function matchRank(
  entry: UidIndexEntry,
  keywordLower: string,
): number | undefined {
  const nameLower = entry.name.toLowerCase();
  if (nameLower.startsWith(keywordLower)) {
    return 0;
  }
  if (nameLower.includes(keywordLower)) {
    return 1;
  }
  const valueLower = entry.value?.toLowerCase() ?? '';
  if (valueLower.includes(keywordLower)) {
    return 2;
  }
  if (entry.path.toLowerCase().includes(keywordLower)) {
    return 3;
  }
  return undefined;
}

/**
 * Searches the index for keyword (case-insensitive substring).
 *
 * Why: Name-prefix matches are ranked first so agents see the most likely
 * interactive target before incidental text/path hits.
 *
 * @param index - Built uid index.
 * @param keyword - Search string (non-empty).
 * @param maxResults - Maximum rows to return (default 20).
 * @returns Matching entries sorted by relevance.
 * @throws Never throws.
 */
export function searchIndex(
  index: Map<number, UidIndexEntry>,
  keyword: string,
  maxResults = 20,
): UidIndexEntry[] {
  const keywordLower = keyword.toLowerCase();
  const scored: ScoredEntry[] = [];

  for (const entry of index.values()) {
    const rank = matchRank(entry, keywordLower);
    if (rank !== undefined) {
      scored.push({entry, rank});
    }
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.entry.path.localeCompare(b.entry.path);
  });

  const out: UidIndexEntry[] = [];
  const limit = Math.max(1, maxResults);
  for (let i = 0; i < scored.length && out.length < limit; i++) {
    const row = scored[i];
    if (row !== undefined) {
      out.push(row.entry);
    }
  }
  return out;
}

/**
 * Looks up a single uid in the index.
 *
 * @param index - Built uid index.
 * @param uid - Target uid.
 * @returns Entry or undefined when absent.
 * @throws Never throws.
 */
export function lookupIndex(
  index: Map<number, UidIndexEntry>,
  uid: number,
): UidIndexEntry | undefined {
  return index.get(uid);
}

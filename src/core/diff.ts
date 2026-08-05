/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Snapshot diff algorithm.
 *
 * Why: After the first full smart_snapshot, agents only need deltas. Diffing by
 * stable uid (not by path) survives reordering of unrelated siblings and keeps
 * each turn's context tiny — the core token-efficiency win of this server.
 */

import type {
  DiffEntry,
  DiffResult,
  StoredSnapshot,
  TextSnapshotNode,
} from '../types.js';

/** In-memory previous snapshot; server restart clears it (first diff → full). */
let previousSnapshot: StoredSnapshot | undefined;

/**
 * Clears stored diff history (tests / server restart simulation).
 *
 * @returns void
 * @throws Never throws.
 */
export function resetDiffHistory(): void {
  previousSnapshot = undefined;
}

/**
 * Stores a snapshot as the baseline for the next diff call.
 *
 * Why: Only the latest snapshot is kept — agents rarely need multi-step history,
 * and unbounded retention would grow memory with session length.
 *
 * @param root - Processed snapshot tree.
 * @param formatted - Formatted text of that tree.
 * @returns void
 * @throws Never throws.
 */
export function storeSnapshot(root: TextSnapshotNode, formatted: string): void {
  previousSnapshot = {
    root,
    byUid: buildUidMap(root),
    formatted,
  };
}

/**
 * Returns the currently stored previous snapshot, if any.
 *
 * @returns Stored snapshot or undefined when none yet.
 * @throws Never throws.
 */
export function getPreviousSnapshot(): StoredSnapshot | undefined {
  return previousSnapshot;
}

/**
 * Builds a uid → node map via BFS.
 *
 * @param root - Snapshot tree.
 * @returns Map covering every node in the tree.
 * @throws Never throws.
 */
export function buildUidMap(
  root: TextSnapshotNode,
): Map<number, TextSnapshotNode> {
  const map = new Map<number, TextSnapshotNode>();
  const queue: TextSnapshotNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    map.set(node.uid, node);
    for (const child of node.children) {
      queue.push(child);
    }
  }
  return map;
}

/**
 * Returns true when two nodes are considered identical for diff purposes.
 *
 * Why: role/name/value/visible/offscreen equality matches what the agent sees.
 * Dedupe counts and collapse summaries live on the formatted display tree only;
 * diffRoot is pre-dedupe so count/collapsed/childCount are not compared here.
 *
 * @param a - Previous node.
 * @param b - Current node.
 * @returns True if attributes match.
 * @throws Never throws.
 */
export function nodesEqual(a: TextSnapshotNode, b: TextSnapshotNode): boolean {
  return (
    a.role === b.role &&
    a.name === b.name &&
    a.value === b.value &&
    a.visible === b.visible &&
    a.offscreen === b.offscreen
  );
}

/**
 * Describes attribute changes between two nodes with the same uid.
 *
 * @param prev - Previous node.
 * @param curr - Current node.
 * @param prevParentUid - Previous parent uid, if any.
 * @param currParentUid - Current parent uid, if any.
 * @returns Human-readable detail string.
 * @throws Never throws.
 */
function changeDetail(
  prev: TextSnapshotNode,
  curr: TextSnapshotNode,
  prevParentUid?: number,
  currParentUid?: number,
): string {
  const parts: string[] = [];
  if (prev.name !== curr.name) {
    parts.push(`"${prev.name}" → "${curr.name}"`);
  }
  if (prev.value !== curr.value) {
    parts.push(`value "${prev.value ?? ''}" → "${curr.value ?? ''}"`);
  }
  if (prev.role !== curr.role) {
    parts.push(`role ${prev.role} → ${curr.role}`);
  }
  if (prev.visible !== curr.visible) {
    parts.push(`visible ${String(prev.visible)} → ${String(curr.visible)}`);
  }
  if (prev.offscreen !== curr.offscreen) {
    parts.push(
      `offscreen ${String(prev.offscreen)} → ${String(curr.offscreen)}`,
    );
  }
  if (prevParentUid !== currParentUid) {
    parts.push(
      `parent uid ${String(prevParentUid ?? 'none')} → ${String(currParentUid ?? 'none')}`,
    );
  }
  return parts.join(', ');
}

/**
 * Emits add/change/removal entries for one pair of sibling lists in DOM order.
 *
 * Why: SPEC §5.6 requires removals interleaved at the parent's child position,
 * not batched after all additions — agents locate deltas by sibling context.
 *
 * @param prevChildren - Previous sibling list.
 * @param currChildren - Current sibling list.
 * @param prevMap - Full previous uid map.
 * @param currMap - Full current uid map.
 * @param prevParentMap - Previous parent links.
 * @param currParentMap - Current parent links.
 * @param entries - Output accumulator.
 * @returns void
 * @throws Never throws.
 */
function diffChildrenInDomOrder(
  prevChildren: TextSnapshotNode[],
  currChildren: TextSnapshotNode[],
  prevMap: Map<number, TextSnapshotNode>,
  currMap: Map<number, TextSnapshotNode>,
  prevParentMap: Map<number, TextSnapshotNode>,
  currParentMap: Map<number, TextSnapshotNode>,
  entries: DiffEntry[],
): void {
  const currUidSet = new Set<number>();
  for (const c of currChildren) {
    currUidSet.add(c.uid);
  }

  let pi = 0;
  let ci = 0;

  while (ci < currChildren.length) {
    const currChild = currChildren[ci];
    if (currChild === undefined) {
      break;
    }

    while (pi < prevChildren.length) {
      const prevChild = prevChildren[pi];
      if (prevChild === undefined) {
        break;
      }
      if (prevChild.uid === currChild.uid) {
        break;
      }
      if (!currUidSet.has(prevChild.uid)) {
        entries.push({kind: 'removed', node: prevChild});
        pi += 1;
        continue;
      }
      pi += 1;
    }

    const prevNode = prevMap.get(currChild.uid);
    const prevParentUid = prevParentMap.get(currChild.uid)?.uid;
    const currParentUid = currParentMap.get(currChild.uid)?.uid;
    const parentChanged = prevParentUid !== currParentUid;
    if (prevNode === undefined) {
      entries.push({kind: 'added', node: currChild});
    } else if (!nodesEqual(prevNode, currChild) || parentChanged) {
      entries.push({
        kind: 'changed',
        node: currChild,
        previous: prevNode,
        detail: changeDetail(prevNode, currChild, prevParentUid, currParentUid),
      });
    }

    const prevForRecurse = prevNode === undefined ? [] : prevNode.children;
    diffChildrenInDomOrder(
      prevForRecurse,
      currChild.children,
      prevMap,
      currMap,
      prevParentMap,
      currParentMap,
      entries,
    );

    if (pi < prevChildren.length) {
      const atPi = prevChildren[pi];
      if (atPi !== undefined && atPi.uid === currChild.uid) {
        pi += 1;
      }
    }
    ci += 1;
  }

  while (pi < prevChildren.length) {
    const prevChild = prevChildren[pi];
    if (prevChild === undefined) {
      break;
    }
    if (!currUidSet.has(prevChild.uid)) {
      entries.push({kind: 'removed', node: prevChild});
    }
    pi += 1;
  }
}

/**
 * Computes the set of added/removed/changed entries between two trees.
 *
 * Why: Walk curr for adds/changes (DOM order of the live page), interleaving
 * removals at each parent's sibling list. Identity is uid — if backendNodeId
 * churned, the old uid disappears and a new uid appears (reported as - and +).
 *
 * @param prevRoot - Previous snapshot root.
 * @param currRoot - Current snapshot root.
 * @returns DiffResult with entries and formatted text.
 * @throws Never throws.
 */
export function computeDiff(
  prevRoot: TextSnapshotNode,
  currRoot: TextSnapshotNode,
): DiffResult {
  const prevMap = buildUidMap(prevRoot);
  const currMap = buildUidMap(currRoot);
  const prevParentMap = buildParentMap(prevRoot);
  const currParentMap = buildParentMap(currRoot);
  const entries: DiffEntry[] = [];

  const prevParentUid = prevParentMap.get(currRoot.uid)?.uid;
  const currParentUid = currParentMap.get(currRoot.uid)?.uid;
  const rootParentChanged = prevParentUid !== currParentUid;
  const prevRootNode = prevMap.get(currRoot.uid);
  if (prevRootNode === undefined) {
    entries.push({kind: 'added', node: currRoot});
  } else if (!nodesEqual(prevRootNode, currRoot) || rootParentChanged) {
    entries.push({
      kind: 'changed',
      node: currRoot,
      previous: prevRootNode,
      detail: changeDetail(
        prevRootNode,
        currRoot,
        prevParentUid,
        currParentUid,
      ),
    });
  }

  diffChildrenInDomOrder(
    prevRootNode === undefined ? [] : prevRootNode.children,
    currRoot.children,
    prevMap,
    currMap,
    prevParentMap,
    currParentMap,
    entries,
  );

  if (entries.length === 0) {
    return {
      identical: true,
      entries,
      text: '(no changes since last snapshot)',
    };
  }

  const text = diffToText(entries, currRoot, prevRoot);
  return {identical: false, entries, text};
}

/**
 * Formats a single node for a diff summary line.
 *
 * @param n - Node to format.
 * @returns Compact `[role] "name" (uid=N)` string.
 */
function formatNodeShort(n: TextSnapshotNode): string {
  const namePart = n.name.length > 0 ? ` "${n.name}"` : '';
  return `[${n.role}]${namePart} (uid=${String(n.uid)})`;
}

/**
 * Formats diff entries into the SPEC text output with summary + context sections.
 *
 * Why: Summary gives a quick scan; context re-anchors each change under its parent
 * so agents know where in the page the delta landed without a full re-snapshot.
 *
 * @param entries - Diff entries in DOM-interleaved order.
 * @param currRoot - Current tree (for parent lookup / context).
 * @param prevRoot - Previous tree (for removed-node parent context).
 * @returns Formatted multiline string.
 * @throws Never throws.
 */
export function diffToText(
  entries: DiffEntry[],
  currRoot: TextSnapshotNode,
  prevRoot: TextSnapshotNode,
): string {
  if (entries.length === 0) {
    return '(no changes since last snapshot)';
  }

  const lines: string[] = ['-- Changes --'];
  for (const entry of entries) {
    if (entry.kind === 'added') {
      lines.push(`+ added ${formatNodeShort(entry.node)}`);
    } else if (entry.kind === 'removed') {
      lines.push(`- removed ${formatNodeShort(entry.node)}`);
    } else {
      const detail = entry.detail ?? '';
      lines.push(`~ changed ${formatNodeShort(entry.node)} ${detail}`);
    }
  }

  lines.push('-- Context --');
  const contextLines = buildContextLines(entries, currRoot, prevRoot);
  for (const line of contextLines) {
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Walks up from a node's parent, skipping synthetic __promoted__ wrappers.
 *
 * Why: Interaction filtering wraps promoted siblings in __promoted__ nodes that
 * formatTree omits; diff context must show the same real parent agents see.
 *
 * @param childUid - Uid of the node whose parent context is needed.
 * @param parentMap - Child uid → parent node map.
 * @returns Real parent for context lines, or undefined at root.
 * @throws Never throws.
 */
function resolveContextParent(
  childUid: number,
  parentMap: Map<number, TextSnapshotNode>,
): TextSnapshotNode | undefined {
  let parent = parentMap.get(childUid);
  while (parent !== undefined && parent.role === '__promoted__') {
    parent = parentMap.get(parent.uid);
  }
  return parent;
}

/**
 * Builds parent-context lines for diff entries (±2 indent levels of context).
 *
 * @param entries - Diff entries.
 * @param currRoot - Current tree.
 * @param prevRoot - Previous tree.
 * @returns Indented context lines.
 */
function buildContextLines(
  entries: DiffEntry[],
  currRoot: TextSnapshotNode,
  prevRoot: TextSnapshotNode,
): string[] {
  const currParent = buildParentMap(currRoot);
  const prevParent = buildParentMap(prevRoot);
  const lines: string[] = [];
  const seenParents = new Set<number>();

  for (const entry of entries) {
    const parentMap = entry.kind === 'removed' ? prevParent : currParent;
    const parent = resolveContextParent(entry.node.uid, parentMap);
    if (parent !== undefined && !seenParents.has(parent.uid)) {
      seenParents.add(parent.uid);
      const namePart = parent.name.length > 0 ? ` "${parent.name}"` : '';
      lines.push(`[${parent.role}]${namePart}`);
    }
    const indent = parent !== undefined ? '  ' : '';
    if (entry.kind === 'added') {
      lines.push(`${indent}+ ${formatNodeShort(entry.node)}`);
    } else if (entry.kind === 'removed') {
      lines.push(`${indent}- ${formatNodeShort(entry.node)}`);
    } else {
      lines.push(`${indent}~ ${formatNodeShort(entry.node)}`);
    }
  }

  return lines;
}

/**
 * Builds a child-uid → parent-node map.
 *
 * @param root - Tree root.
 * @returns Map from child uid to its parent node.
 */
function buildParentMap(root: TextSnapshotNode): Map<number, TextSnapshotNode> {
  const map = new Map<number, TextSnapshotNode>();
  const queue: TextSnapshotNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    for (const child of node.children) {
      map.set(child.uid, node);
      queue.push(child);
    }
  }
  return map;
}

/**
 * Returns the text field of a DiffResult (helper for tests / callers).
 *
 * @param result - Diff result.
 * @returns Formatted text.
 * @throws Never throws.
 */
export function formatDiffResult(result: DiffResult): string {
  return result.text;
}

/**
 * High-level snapshot_diff entry: first call returns full tree + notice; later calls diff.
 *
 * Why: Agents should call snapshot_diff every step after the first without special-casing
 * the initial empty history — we degrade gracefully to a full snapshot once.
 *
 * @param currRoot - Current processed snapshot tree.
 * @param formatted - Formatted text of currRoot (from formatTree).
 * @returns Text to return to the MCP client.
 * @throws Never throws.
 */
export function runSnapshotDiff(
  currRoot: TextSnapshotNode,
  formatted: string,
): string {
  const prev = previousSnapshot;
  if (prev === undefined) {
    storeSnapshot(currRoot, formatted);
    return `${formatted}\n(initial snapshot, no diff available)`;
  }

  const result = computeDiff(prev.root, currRoot);
  storeSnapshot(currRoot, formatted);
  return result.text;
}

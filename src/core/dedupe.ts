/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Sibling deduplication for snapshot trees.
 *
 * Why: Repeated identical controls (e.g. "Sent" ×3 in a mail list) waste tokens.
 * Merging consecutive same role+name siblings into ×N keeps one representative uid
 * so agents can still target the first instance while reading a compact tree.
 */

import type {TextSnapshotNode} from '../types.js';

/**
 * Merges consecutive siblings that share the same role and name into a counted node.
 *
 * Why: Only *consecutive* siblings are merged so non-adjacent duplicates that sit
 * in different visual groups remain distinguishable. The first uid is kept so
 * click/fill still has a stable handle.
 *
 * @param root - Input snapshot tree (typically after interaction filtering).
 * @returns A new tree with consecutive duplicates collapsed and `count` set.
 * @throws Never throws.
 */
export function dedupeTree(root: TextSnapshotNode): TextSnapshotNode {
  const dedupedChildren: TextSnapshotNode[] = [];

  for (const child of root.children) {
    const processed = dedupeTree(child);
    const prev = dedupedChildren[dedupedChildren.length - 1];

    if (
      prev !== undefined &&
      prev.role === processed.role &&
      prev.name === processed.name
    ) {
      // Extend the run: bump count on the representative (first) node.
      const nextCount = (prev.count ?? 1) + (processed.count ?? 1);
      dedupedChildren[dedupedChildren.length - 1] = {
        ...prev,
        count: nextCount,
      };
    } else {
      dedupedChildren.push(processed);
    }
  }

  return {...root, children: dedupedChildren};
}

/**
 * Collapses child nodes that repeat their parent's name.
 *
 * Why: Many SPA shells (YouTube nav, Baidu search bar) nest identical labels —
 * `[link] "首页" → [link] "首页" → [text] "首页"`. Emitting all three triples
 * the output for no extra information. When a child shares the parent's name
 * and has no other meaningful children, fold it into the parent line.
 *
 * @param root - Snapshot tree (typically after dedupe).
 * @returns Tree with same-name child chains collapsed.
 * @throws Never throws.
 */
export function collapseSameNameChildren(root: TextSnapshotNode): TextSnapshotNode {
  const keptChildren: TextSnapshotNode[] = [];

  for (const child of root.children) {
    const processed = collapseSameNameChildren(child);

    // Fold a child whose name equals the parent's name and which is not a
    // landmark/container with distinct siblings (it adds no information).
    const sameNameAsParent =
      processed.name.length > 0 && processed.name === root.name;
    const isBareTextLeaf =
      (processed.role === 'text' || processed.role === 'StaticText') &&
      processed.children.length === 0;
    const isSameRoleLinkChain =
      processed.role === root.role &&
      processed.children.every(
        grandchild =>
          grandchild.name === root.name || grandchild.name === '',
      );

    if (sameNameAsParent && (isBareTextLeaf || isSameRoleLinkChain)) {
      // Skip this child; the parent line already carries the name.
      continue;
    }
    keptChildren.push(processed);
  }

  return {...root, children: keptChildren};
}

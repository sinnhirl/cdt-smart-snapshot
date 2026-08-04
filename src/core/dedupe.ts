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
import {isInteractiveRole} from './interaction.js';

/**
 * Returns true when two nodes match on fields used for sibling merge eligibility.
 *
 * @param a - First sibling.
 * @param b - Second sibling.
 * @returns True when role, name, value, and visibility flags align.
 * @throws Never throws.
 */
function siblingMergeAttributesEqual(
  a: TextSnapshotNode,
  b: TextSnapshotNode,
): boolean {
  return (
    a.role === b.role &&
    a.name === b.name &&
    a.value === b.value &&
    a.visible === b.visible &&
    a.offscreen === b.offscreen
  );
}

/**
 * Compares two subtrees structurally (role/name/value per node, child count/order).
 *
 * Why: Dedupe must not discard a duplicate sibling's distinct children — only
 * merge when both subtrees carry the same shape or both are leaves.
 *
 * @param a - First subtree root.
 * @param b - Second subtree root.
 * @returns True when structures match.
 * @throws Never throws.
 */
function subtreesStructurallyEqual(
  a: TextSnapshotNode,
  b: TextSnapshotNode,
): boolean {
  if (a.role !== b.role || a.name !== b.name || a.value !== b.value) {
    return false;
  }
  if (a.children.length !== b.children.length) {
    return false;
  }
  for (let i = 0; i < a.children.length; i++) {
    const ac = a.children[i];
    const bc = b.children[i];
    if (ac === undefined || bc === undefined) {
      return false;
    }
    if (!subtreesStructurallyEqual(ac, bc)) {
      return false;
    }
  }
  return true;
}

/**
 * Returns true when consecutive siblings may be merged into a counted node.
 *
 * @param prev - Earlier sibling (representative).
 * @param next - Candidate duplicate sibling.
 * @returns True when merge is safe.
 * @throws Never throws.
 */
function canMergeConsecutiveSiblings(
  prev: TextSnapshotNode,
  next: TextSnapshotNode,
): boolean {
  if (!siblingMergeAttributesEqual(prev, next)) {
    return false;
  }
  if (prev.children.length === 0 && next.children.length === 0) {
    return true;
  }
  return subtreesStructurallyEqual(prev, next);
}

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

    if (prev !== undefined && canMergeConsecutiveSiblings(prev, processed)) {
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
export function collapseSameNameChildren(
  root: TextSnapshotNode,
): TextSnapshotNode {
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
      processed.children.every(grandchild => {
        if (grandchild.name.length > 0 && grandchild.name !== root.name) {
          return false;
        }
        if (
          grandchild.name === '' &&
          isInteractiveRole(grandchild.role, grandchild.name)
        ) {
          return false;
        }
        return true;
      });

    if (sameNameAsParent && (isBareTextLeaf || isSameRoleLinkChain)) {
      // Skip this child; the parent line already carries the name.
      continue;
    }
    keptChildren.push(processed);
  }

  return {...root, children: keptChildren};
}

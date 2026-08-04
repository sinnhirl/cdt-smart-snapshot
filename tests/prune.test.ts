/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {describe, expect, it} from 'vitest';

import {pruneTree} from '../src/core/prune.js';
import type {TextSnapshotNode} from '../src/types.js';

/**
 * Builds a deep chain: root → child → grandchild → ... for depth tests.
 * @param depth - Number of edges from root to leaf (leaf depth = depth).
 * @returns Root node with uid 1; each level increments uid.
 */
function deepChain(depth: number): TextSnapshotNode {
  let current: TextSnapshotNode = {
    uid: depth + 1,
    role: 'text',
    name: `leaf-${depth}`,
    children: [],
  };
  for (let d = depth - 1; d >= 0; d--) {
    current = {
      uid: d + 1,
      role: d === 0 ? 'Document' : 'article',
      name: `level-${d}`,
      children: [current],
    };
  }
  return current;
}

describe('prune', () => {
  it('shouldCollapseSubtreeBeyondMaxDepth', () => {
    // depth 0=Document, 1=article, 2=article, 3=text
    const tree = deepChain(3);
    const pruned = pruneTree(tree, 2);
    // At maxDepth=2, the node at depth 2 should be collapsed (no deeper children listed).
    const level1 = pruned.children[0];
    expect(level1).toBeDefined();
    if (level1 !== undefined) {
      const level2 = level1.children[0];
      expect(level2).toBeDefined();
      if (level2 !== undefined) {
        expect(level2.collapsed).toBe(true);
        expect(level2.children).toHaveLength(0);
      }
    }
  });

  it('shouldShowCollapsedSummaryWithChildCountAndUid', () => {
    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'Document',
      name: 'page',
      children: [
        {
          uid: 2,
          role: 'main',
          name: 'Main',
          children: [
            {
              uid: 3,
              role: 'article',
              name: 'Parent',
              children: [
                {uid: 4, role: 'link', name: 'A', children: []},
                {uid: 5, role: 'link', name: 'B', children: []},
                {uid: 6, role: 'text', name: 'C', children: []},
              ],
            },
          ],
        },
      ],
    };
    // maxDepth=2 → article at depth 2 collapses its 3 children.
    const pruned = pruneTree(tree, 2);
    const main = pruned.children[0];
    expect(main).toBeDefined();
    if (main !== undefined) {
      const article = main.children[0];
      expect(article).toBeDefined();
      if (article !== undefined) {
        expect(article.collapsed).toBe(true);
        expect(article.childCount).toBe(3);
        expect(article.uid).toBe(3);
        expect(article.name).toBe('Parent');
      }
    }
  });
});

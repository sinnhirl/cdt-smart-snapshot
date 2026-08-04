/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {describe, expect, it} from 'vitest';

import {collapseSameNameChildren, dedupeTree} from '../src/core/dedupe.js';
import type {TextSnapshotNode} from '../src/types.js';

/**
 * Builds a node for dedupe tests.
 * @param uid - Stable uid.
 * @param role - AX role.
 * @param name - Accessible name.
 * @param children - Optional children.
 * @returns TextSnapshotNode.
 */
function node(
  uid: number,
  role: string,
  name: string,
  children: TextSnapshotNode[] = [],
): TextSnapshotNode {
  return {uid, role, name, children};
}

describe('dedupe', () => {
  it('shouldMergeConsecutiveSameRoleNameSiblingsIntoCount', () => {
    const tree = node(1, 'main', 'Main', [
      node(2, 'link', 'Sent'),
      node(3, 'link', 'Sent'),
      node(4, 'link', 'Sent'),
    ]);
    const result = dedupeTree(tree);
    expect(result.children).toHaveLength(1);
    const first = result.children[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first.count).toBe(3);
      expect(first.role).toBe('link');
      expect(first.name).toBe('Sent');
    }
  });

  it('shouldNotMergeDifferentRoles', () => {
    const tree = node(1, 'main', 'Main', [
      node(2, 'link', 'A'),
      node(3, 'button', 'A'),
      node(4, 'link', 'A'),
    ]);
    const result = dedupeTree(tree);
    expect(result.children).toHaveLength(3);
  });

  it('shouldKeepFirstUidAsRepresentative', () => {
    const tree = node(1, 'main', 'Main', [
      node(18, 'link', 'Sent'),
      node(19, 'link', 'Sent'),
      node(20, 'link', 'Sent'),
    ]);
    const result = dedupeTree(tree);
    const first = result.children[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first.uid).toBe(18);
      expect(first.count).toBe(3);
    }
  });
});

describe('collapseSameNameChildren', () => {
  it('shouldCollapseSameNameTextChild', () => {
    // [link] "首页" → [text] "首页" collapses to just the link.
    const tree = node(1, 'navigation', 'Nav', [
      node(18, 'link', '首页', [node(19, 'text', '首页')]),
      node(20, 'link', '订阅'),
    ]);
    const result = collapseSameNameChildren(tree);
    const home = result.children[0];
    expect(home).toBeDefined();
    if (home !== undefined) {
      expect(home.children).toHaveLength(0);
    }
    expect(result.children).toHaveLength(2);
  });

  it('shouldCollapseSameRoleLinkChain', () => {
    // [link] "首页" → [link] "首页" collapses the nested link.
    const tree = node(1, 'navigation', 'Nav', [
      node(18, 'link', '首页', [node(19, 'link', '首页')]),
    ]);
    const result = collapseSameNameChildren(tree);
    const home = result.children[0];
    expect(home).toBeDefined();
    if (home !== undefined) {
      expect(home.children).toHaveLength(0);
    }
  });

  it('shouldKeepDistinctChildren', () => {
    // [link] "首页" with a meaningful child stays intact.
    const tree = node(1, 'navigation', 'Nav', [
      node(18, 'link', '首页', [node(19, 'text', 'Home page')]),
    ]);
    const result = collapseSameNameChildren(tree);
    const home = result.children[0];
    expect(home).toBeDefined();
    if (home !== undefined) {
      expect(home.children).toHaveLength(1);
    }
  });
});

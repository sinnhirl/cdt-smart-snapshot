import {describe, expect, it} from 'vitest';

import {dedupeTree} from '../src/core/dedupe.js';
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

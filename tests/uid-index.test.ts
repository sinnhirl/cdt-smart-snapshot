/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {describe, expect, it} from 'vitest';

import {
  buildUidIndex,
  lookupIndex,
  searchIndex,
} from '../src/core/uid-index.js';
import type {TextSnapshotNode} from '../src/types.js';

/**
 * Builds a minimal snapshot node for uid-index tests.
 *
 * @param uid - Stable uid.
 * @param role - AX role.
 * @param name - Accessible name.
 * @param children - Child nodes.
 * @param extra - Optional value/backendNodeId.
 * @returns TextSnapshotNode.
 */
function node(
  uid: number,
  role: string,
  name: string,
  children: TextSnapshotNode[] = [],
  extra?: {value?: string; backendNodeId?: number},
): TextSnapshotNode {
  const n: TextSnapshotNode = {uid, role, name, children};
  if (extra?.value !== undefined) {
    n.value = extra.value;
  }
  if (extra?.backendNodeId !== undefined) {
    n.backendNodeId = extra.backendNodeId;
  }
  return n;
}

describe('uid-index', () => {
  it('shouldBuildPathRoleNameAndChildCountViaBfs', () => {
    const tree = node(1, 'RootWebArea', 'example.com', [
      node(2, 'main', '', [
        node(3, 'button', 'Go', [], {backendNodeId: 99}),
      ]),
    ]);
    const index = buildUidIndex(tree);
    const root = lookupIndex(index, 1);
    const main = lookupIndex(index, 2);
    const btn = lookupIndex(index, 3);
    expect(root?.path).toBe('RootWebArea "example.com"');
    expect(root?.childCount).toBe(1);
    expect(main?.path).toBe('RootWebArea "example.com" > main');
    expect(btn?.path).toBe('RootWebArea "example.com" > main > button "Go"');
    expect(btn?.role).toBe('button');
    expect(btn?.name).toBe('Go');
    expect(btn?.backendNodeId).toBe(99);
    expect(btn?.childCount).toBe(0);
  });

  it('shouldFlattenPromotedWrappersWhenBuildingPaths', () => {
    const tree: TextSnapshotNode = {
      uid: 1,
      role: '__promoted__',
      name: '',
      children: [node(2, 'button', 'OK')],
    };
    const index = buildUidIndex(tree);
    expect(lookupIndex(index, 2)?.path).toBe('button "OK"');
  });

  it('shouldSearchCaseInsensitivelyWithNamePrefixRankFirst', () => {
    const tree = node(1, 'Document', 'page', [
      node(2, 'link', 'Advanced search'),
      node(3, 'button', 'Search'),
      node(4, 'text', 'search hints'),
    ]);
    const index = buildUidIndex(tree);
    const hits = searchIndex(index, 'search', 20);
    expect(hits.map(h => h.uid)).toEqual([3, 4, 2]);
  });

  it('shouldSearchValueAndPathWhenNameDoesNotMatch', () => {
    const tree = node(1, 'Document', 'page', [
      node(2, 'textbox', 'Email', [], {value: 'user@example.com'}),
      node(3, 'navigation', 'Side', [
        node(4, 'link', 'Home'),
      ]),
    ]);
    const index = buildUidIndex(tree);
    const byValue = searchIndex(index, 'user@', 10);
    expect(byValue.length).toBe(1);
    expect(byValue[0]?.uid).toBe(2);
    const byPath = searchIndex(index, 'navigation', 10);
    expect(byPath.some(h => h.uid === 3)).toBe(true);
  });

  it('shouldCapSearchResultsAtMaxResults', () => {
    const children: TextSnapshotNode[] = [];
    for (let i = 0; i < 30; i++) {
      children.push(node(i + 2, 'link', `item search ${String(i)}`));
    }
    const tree = node(1, 'Document', 'page', children);
    const index = buildUidIndex(tree);
    const hits = searchIndex(index, 'search', 5);
    expect(hits.length).toBe(5);
  });

  it('shouldLookupIndexHitAndMiss', () => {
    const tree = node(1, 'Document', 'p', [node(2, 'button', 'X')]);
    const index = buildUidIndex(tree);
    expect(lookupIndex(index, 2)?.name).toBe('X');
    expect(lookupIndex(index, 999)).toBeUndefined();
  });
});

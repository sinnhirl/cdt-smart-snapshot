/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {beforeEach, describe, expect, it} from 'vitest';

import {
  buildUidMap,
  computeDiff,
  diffToText,
  formatDiffResult,
  resetDiffHistory,
  runSnapshotDiff,
  storeSnapshot,
} from '../src/core/diff.js';
import type {TextSnapshotNode} from '../src/types.js';

/**
 * Builds a simple node.
 * @param uid - Stable uid.
 * @param role - Role.
 * @param name - Name.
 * @param children - Children.
 * @param value - Optional value.
 * @returns TextSnapshotNode.
 */
function node(
  uid: number,
  role: string,
  name: string,
  children: TextSnapshotNode[] = [],
  value?: string,
): TextSnapshotNode {
  const n: TextSnapshotNode = {uid, role, name, children};
  if (value !== undefined) {
    n.value = value;
  }
  return n;
}

describe('diff', () => {
  beforeEach(() => {
    resetDiffHistory();
  });

  it('shouldReportAddedNode', () => {
    const prev = node(1, 'main', 'Main', [node(2, 'link', 'Old')]);
    const curr = node(1, 'main', 'Main', [
      node(2, 'link', 'Old'),
      node(3, 'link', 'New'),
    ]);
    const result = computeDiff(prev, curr);
    expect(result.identical).toBe(false);
    expect(
      result.entries.some(e => e.kind === 'added' && e.node.uid === 3),
    ).toBe(true);
    expect(result.text).toContain('+');
    expect(result.text).toContain('New');
  });

  it('shouldReportRemovedNode', () => {
    const prev = node(1, 'main', 'Main', [
      node(2, 'link', 'Keep'),
      node(3, 'link', 'Gone'),
    ]);
    const curr = node(1, 'main', 'Main', [node(2, 'link', 'Keep')]);
    const result = computeDiff(prev, curr);
    expect(
      result.entries.some(e => e.kind === 'removed' && e.node.uid === 3),
    ).toBe(true);
    expect(result.text).toContain('Gone');
  });

  it('shouldReportChangedName', () => {
    const prev = node(1, 'main', 'Main', [node(2, 'text', '2 unread')]);
    const curr = node(1, 'main', 'Main', [node(2, 'text', '3 unread')]);
    const result = computeDiff(prev, curr);
    const changed = result.entries.find(e => e.kind === 'changed');
    expect(changed).toBeDefined();
    if (changed !== undefined) {
      expect(changed.node.uid).toBe(2);
      expect(changed.detail).toContain('2 unread');
      expect(changed.detail).toContain('3 unread');
    }
  });

  it('shouldReportChangedValue', () => {
    const prev = node(1, 'main', 'Main', [
      node(2, 'textbox', 'Email', [], 'a@x.com'),
    ]);
    const curr = node(1, 'main', 'Main', [
      node(2, 'textbox', 'Email', [], 'b@y.com'),
    ]);
    const result = computeDiff(prev, curr);
    const changed = result.entries.find(e => e.kind === 'changed');
    expect(changed).toBeDefined();
    if (changed !== undefined) {
      expect(changed.detail).toContain('a@x.com');
      expect(changed.detail).toContain('b@y.com');
    }
  });

  it('shouldSkipUnchangedNodes', () => {
    const prev = node(1, 'main', 'Main', [node(2, 'link', 'Same')]);
    const curr = node(1, 'main', 'Main', [node(2, 'link', 'Same')]);
    const result = computeDiff(prev, curr);
    expect(result.entries).toHaveLength(0);
  });

  it('shouldReturnNoChangesMessageWhenIdentical', () => {
    const prev = node(1, 'Document', 'page', [node(2, 'button', 'OK')]);
    const curr = node(1, 'Document', 'page', [node(2, 'button', 'OK')]);
    const result = computeDiff(prev, curr);
    expect(result.identical).toBe(true);
    expect(result.text).toBe('(no changes since last snapshot)');
  });

  it('shouldReturnInitialSnapshotOnFirstCall', () => {
    const curr = node(1, 'Document', 'example.com', [
      node(2, 'button', 'Compose'),
    ]);
    const formatted = '[Document] example.com\n  [button] "Compose" (uid=2)';
    const text = runSnapshotDiff(curr, formatted);
    expect(text).toContain('(initial snapshot, no diff available)');
    expect(text).toContain('[Document] example.com');
  });

  it('shouldSortOutputByDomOrder', () => {
    const prev = node(1, 'main', 'Main', [
      node(2, 'link', 'A'),
      node(3, 'link', 'B'),
      node(4, 'link', 'C'),
    ]);
    const curr = node(1, 'main', 'Main', [
      node(2, 'link', 'A2'),
      node(5, 'link', 'New'),
      node(4, 'link', 'C'),
    ]);
    // removed B (3), changed A→A2 (2), added New (5)
    const result = computeDiff(prev, curr);
    const text = diffToText(result.entries, curr, prev);
    const posChanged = text.indexOf('A2');
    const posAdded = text.indexOf('New');
    const posRemoved = text.indexOf('B');
    expect(posChanged).toBeGreaterThanOrEqual(0);
    expect(posAdded).toBeGreaterThanOrEqual(0);
    expect(posRemoved).toBeGreaterThanOrEqual(0);
    // DOM order in curr: A2 then New; removed B should appear near its old sibling position.
    expect(posChanged).toBeLessThan(posAdded);
  });
});

describe('diff helpers', () => {
  it('buildUidMap indexes all nodes', () => {
    const tree = node(1, 'a', 'A', [node(2, 'b', 'B')]);
    const map = buildUidMap(tree);
    expect(map.size).toBe(2);
    expect(map.get(2)?.name).toBe('B');
  });

  it('storeSnapshot and formatDiffResult round-trip identical', () => {
    resetDiffHistory();
    const tree = node(1, 'Document', 'x');
    storeSnapshot(tree, '[Document] x');
    const again = computeDiff(tree, tree);
    expect(formatDiffResult(again)).toBe('(no changes since last snapshot)');
  });
});

/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {describe, expect, it} from 'vitest';

import {
  isInteractiveRole,
  filterByInteraction,
} from '../src/core/interaction.js';
import type {TextSnapshotNode} from '../src/types.js';

/**
 * Minimal node factory for interaction tests.
 * @param uid - Stable uid.
 * @param role - AX role.
 * @param name - Accessible name.
 * @param children - Optional children.
 * @returns A TextSnapshotNode.
 */
function node(
  uid: number,
  role: string,
  name = '',
  children: TextSnapshotNode[] = [],
): TextSnapshotNode {
  return {uid, role, name, children};
}

/**
 * Collects all roles in a tree (pre-order).
 * @param root - Tree root.
 * @returns Flat list of role strings.
 */
function collectRoles(root: TextSnapshotNode): string[] {
  const roles: string[] = [root.role];
  for (const child of root.children) {
    for (const r of collectRoles(child)) {
      roles.push(r);
    }
  }
  return roles;
}

describe('interaction', () => {
  it('shouldKeepButtonRole', () => {
    expect(isInteractiveRole('button', 'OK')).toBe(true);
    const result = filterByInteraction(node(1, 'button', 'Submit'), false);
    expect(result).toBeDefined();
    if (result !== undefined) {
      expect(result.role).toBe('button');
    }
  });

  it('shouldKeepLinkRoleWithName', () => {
    expect(isInteractiveRole('link', 'Inbox')).toBe(true);
    const result = filterByInteraction(node(1, 'link', 'Inbox'), false);
    expect(result).toBeDefined();
  });

  it('shouldKeepInputRole', () => {
    expect(isInteractiveRole('textbox', 'Email')).toBe(true);
    expect(isInteractiveRole('input', 'Search')).toBe(true);
    const result = filterByInteraction(node(1, 'textbox', 'Email'), false);
    expect(result).toBeDefined();
  });

  it('shouldCollapseGenericContainer', () => {
    const tree = node(1, 'generic', '', [
      node(2, 'button', 'Go'),
      node(3, 'link', 'Home'),
    ]);

    const result = filterByInteraction(tree, false);
    expect(result).toBeDefined();
    if (result !== undefined) {
      const roles = collectRoles(result);
      expect(roles).toContain('button');
      expect(roles).toContain('link');
      expect(roles).not.toContain('generic');
    }
  });

  it('shouldKeepRegionWithNameAndCollapseWithout', () => {
    expect(isInteractiveRole('region', 'Sidebar')).toBe(true);
    expect(isInteractiveRole('region', '')).toBe(false);

    const named = filterByInteraction(node(1, 'region', 'Sidebar'), false);
    expect(named).toBeDefined();
    if (named !== undefined) {
      expect(named.role).toBe('region');
    }

    const unnamed = node(10, 'region', '', [node(11, 'button', 'X')]);
    const collapsed = filterByInteraction(unnamed, false);
    expect(collapsed).toBeDefined();
    if (collapsed !== undefined) {
      const roles = collectRoles(collapsed);
      expect(roles).toContain('button');
      expect(roles).not.toContain('region');
    }
  });

  it('shouldKeepTextNodeWithNonEmptyName', () => {
    expect(isInteractiveRole('text', 'Hello')).toBe(true);
    expect(isInteractiveRole('text', '')).toBe(false);
    expect(isInteractiveRole('text', '   ')).toBe(false);

    const kept = filterByInteraction(node(1, 'text', '3 unread'), false);
    expect(kept).toBeDefined();

    const dropped = filterByInteraction(node(1, 'text', ''), false);
    expect(dropped).toBeUndefined();
  });
});

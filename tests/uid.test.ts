/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {describe, expect, it} from 'vitest';

import {UidMapper} from '../src/core/uid.js';

describe('uid', () => {
  it('shouldAssignStableUidFromBackendNodeId', () => {
    const mapper = new UidMapper();
    const uid = mapper.getUid(1001);
    expect(uid).toBeTypeOf('number');
    expect(uid).toBeGreaterThan(0);
  });

  it('shouldReuseUidForSameBackendNodeAcrossSnapshots', () => {
    const mapper = new UidMapper();
    const first = mapper.getUid(42);
    // Simulate a second snapshot: same mapper instance (server lifetime).
    const second = mapper.getUid(42);
    expect(second).toBe(first);

    const other = mapper.getUid(99);
    expect(other).not.toBe(first);
  });

  it('shouldReuseUidForSameLogicalPathAcrossSnapshots', () => {
    const mapper = new UidMapper();
    // AX-only node (no backendNodeId) at parent 7, role text, name "3 unread",
    // sibling index 2 — same logical position across snapshots.
    const first = mapper.getUidForLogicalPath(7, 'text', '3 unread', 2);
    const second = mapper.getUidForLogicalPath(7, 'text', '3 unread', 2);
    expect(second).toBe(first);
  });

  it('shouldKeepUidStableWhenTextContentChanges', () => {
    const mapper = new UidMapper();
    // Same logical position, text changes "3 unread" → "4 unread" (the most
    // common dynamic-page diff event). Identity must NOT depend on text:
    // otherwise every content change reports a spurious removed+added pair.
    const first = mapper.getUidForLogicalPath(7, 'text', '3 unread', 2);
    const second = mapper.getUidForLogicalPath(7, 'text', '4 unread', 2);
    expect(second).toBe(first);
  });

  it('shouldDistinguishDifferentLogicalPaths', () => {
    const mapper = new UidMapper();
    // Position (parentUid, role, siblingIndex) is the identity — text is not.
    const a = mapper.getUidForLogicalPath(7, 'text', '3 unread', 2);
    const b = mapper.getUidForLogicalPath(7, 'text', '4 unread', 2);
    const c = mapper.getUidForLogicalPath(8, 'text', '3 unread', 2);
    const d = mapper.getUidForLogicalPath(7, 'text', '3 unread', 3);
    const e = mapper.getUidForLogicalPath(7, 'link', '3 unread', 2);
    expect(b).toBe(a); // same position, different text → same uid (by design)
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
    expect(e).not.toBe(a);
  });

  it('shouldResetClearsMappingsSoUidsRestart', () => {
    const mapper = new UidMapper();
    // Two distinct paths consume uids 1 and 2.
    const first = mapper.getUidForLogicalPath(7, 'text', '3 unread', 2);
    const second = mapper.getUidForLogicalPath(8, 'link', 'Inbox', 0);
    expect(second).toBe(first + 1);

    // After reset, a brand-new path starts again from the fresh counter — the
    // old mapping is gone (reset isolation for tests).
    mapper.reset();
    const fresh = mapper.getUidForLogicalPath(9, 'button', 'Compose', 0);
    expect(fresh).toBe(1);
  });
});

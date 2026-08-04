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

  it('shouldGenerateFreshUidWhenBackendNodeIdMissing', () => {
    const mapper = new UidMapper();
    const a = mapper.getUid(undefined);
    const b = mapper.getUid(undefined);
    expect(a).toBeTypeOf('number');
    expect(b).toBeTypeOf('number');
    expect(a).not.toBe(b);
  });
});

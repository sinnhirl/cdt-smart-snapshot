/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Stable uid mapping from Chromium backendNodeId.
 *
 * Why: Diff needs to recognize the "same" element across snapshots. backendNodeId
 * is stable for the lifetime of a DOM node in the browser; mapping it to a small
 * integer uid keeps the text tree compact and comparable.
 */

/**
 * Maps backendNodeId → uid for the lifetime of the MCP server process.
 *
 * Why: A single mapper instance lets smart_snapshot and snapshot_diff share
 * identity. Missing backendNodeIds get fresh incremental uids (treated as new
 * nodes on every encounter — correct for ephemeral AX-only nodes).
 */
export class UidMapper {
  private readonly byBackendId = new Map<number, number>();
  private nextUid = 1;

  /**
   * Returns a stable uid for the given backendNodeId, or a fresh uid if missing.
   *
   * @param backendNodeId - Chromium backend DOM node id, or undefined when absent.
   * @returns Positive integer uid.
   * @throws Never throws.
   */
  getUid(backendNodeId: number | undefined): number {
    if (backendNodeId === undefined) {
      const uid = this.nextUid;
      this.nextUid += 1;
      return uid;
    }

    const existing = this.byBackendId.get(backendNodeId);
    if (existing !== undefined) {
      return existing;
    }

    const uid = this.nextUid;
    this.nextUid += 1;
    this.byBackendId.set(backendNodeId, uid);
    return uid;
  }

  /**
   * Resets all mappings (useful in tests).
   *
   * @returns void
   * @throws Never throws.
   */
  reset(): void {
    this.byBackendId.clear();
    this.nextUid = 1;
  }
}

/** Process-wide default mapper shared by tools. */
export const defaultUidMapper = new UidMapper();

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
 * identity. Missing backendNodeIds get a stable logical-path uid so nodes
 * without a DOM handle (pure AX nodes) still diff correctly instead of being
 * treated as brand-new on every snapshot.
 */
export class UidMapper {
  private readonly byBackendId = new Map<number, number>();
  private readonly byLogicalPath = new Map<string, number>();
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
   * Returns a stable uid for a node without a backendNodeId, keyed by its
   * logical position in the tree.
   *
   * Why: AX-only nodes (text/static under a parent that has a DOM handle) have
   * no backendNodeId. Assigning a fresh uid each snapshot makes diff report
   * spurious removed+added every round. Keying on (parentUid, role, name,
   * siblingIndex) is stable as long as the parent exists and the sibling order
   * is unchanged — exactly the nodes whose identity we can trust positionally.
   *
   * @param parentUid - Uid of the parent node (root has 0).
   * @param role - AX role.
   * @param name - Accessible name.
   * @param siblingIndex - 0-based index among the parent's AX children.
   * @returns Positive integer uid.
   * @throws Never throws.
   */
  getUidForLogicalPath(
    parentUid: number,
    role: string,
    name: string,
    siblingIndex: number,
  ): number {
    const key = `${parentUid}|${role}|${name}|${siblingIndex}`;
    const existing = this.byLogicalPath.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const uid = this.nextUid;
    this.nextUid += 1;
    this.byLogicalPath.set(key, uid);
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
    this.byLogicalPath.clear();
    this.nextUid = 1;
  }
}

/** Process-wide default mapper shared by tools. */
export const defaultUidMapper = new UidMapper();

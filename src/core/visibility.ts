/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Visibility assessment for AX/DOM nodes.
 *
 * Why: Agents only need nodes a human can see. CSS-hidden and zero-size nodes
 * burn tokens without helping navigation. Offscreen is tracked separately so
 * includeHidden can keep those nodes while still dropping true hidden ones by default.
 */

import type {
  ElementVisibilityInfo,
  TextSnapshotNode,
  VisibilityState,
} from '../types.js';

/**
 * Assesses whether an element is painted/has size and whether it lies offscreen.
 *
 * Why: Separating "hidden" (display/visibility/opacity/zero-size) from "offscreen"
 * lets the snapshot pipeline drop invisible chrome by default while still allowing
 * includeHidden to retain offscreen content for debugging.
 *
 * @param info - CSS and geometry facts collected via page.evaluate.
 * @returns Visibility flags: visible (not CSS-hidden, non-zero size) and offscreen.
 * @throws Never throws; callers must supply complete ElementVisibilityInfo.
 */
export function assessVisibility(info: ElementVisibilityInfo): VisibilityState {
  // CSS-hidden or fully transparent → treat as hidden (not offscreen).
  if (
    info.display === 'none' ||
    info.visibility === 'hidden' ||
    info.opacity === 0
  ) {
    return {visible: false, offscreen: false};
  }

  // Zero-area boxes never paint meaningful content.
  if (info.rect.width <= 0 || info.rect.height <= 0) {
    return {visible: false, offscreen: false};
  }

  // Offscreen: the rect lies entirely outside the viewport (any side).
  const offscreen =
    info.rect.bottom < 0 ||
    info.rect.top > info.viewportHeight ||
    info.rect.right < 0 ||
    info.rect.left > info.viewportWidth;

  return {visible: true, offscreen};
}

/**
 * Applies visibility flags onto a tree using a uid → ElementVisibilityInfo map.
 *
 * Why: browser.ts batch-queries DOM geometry once; this pure step stamps results
 * onto nodes so later filters can drop hidden/offscreen without touching puppeteer.
 * Nodes missing from the map keep visible/offscreen undefined (never assumed visible).
 *
 * @param root - Snapshot tree whose nodes already have stable uids.
 * @param infoByUid - Geometry/CSS info keyed by node uid.
 * @returns A new tree with visible/offscreen set on every node that had info.
 * @throws Never throws; missing info leaves visible/offscreen undefined.
 */
export function applyVisibility(
  root: TextSnapshotNode,
  infoByUid: Map<number, ElementVisibilityInfo>,
): TextSnapshotNode {
  const info = infoByUid.get(root.uid);
  const children: TextSnapshotNode[] = [];
  for (const child of root.children) {
    children.push(applyVisibility(child, infoByUid));
  }

  if (info === undefined) {
    return {
      ...root,
      children,
    };
  }

  const state = assessVisibility(info);
  return {
    ...root,
    children,
    visible: state.visible,
    offscreen: state.offscreen,
  };
}

/**
 * Marks nodes with a DOM backend id as visible when per-node geometry was skipped.
 *
 * Why: On huge pages we skip per-node CDP collection; without this stamp every
 * node would be unevaluated and hideUnevaluated would drop the entire tree.
 * AX-only nodes (no backendNodeId) stay unevaluated and are still dropped.
 *
 * @param root - Normalized tree before visibility filtering.
 * @returns Tree copy with visible/offscreen set on backend-linked nodes only.
 * @throws Never throws.
 */
export function stampOptimisticDomVisibility(
  root: TextSnapshotNode,
): TextSnapshotNode {
  const children: TextSnapshotNode[] = [];
  for (const child of root.children) {
    children.push(stampOptimisticDomVisibility(child));
  }
  if (root.backendNodeId !== undefined) {
    return {
      ...root,
      children,
      visible: true,
      offscreen: false,
    };
  }
  return {...root, children};
}

/**
 * Returns true when a node should be dropped for visibility (not includeHidden).
 *
 * @param root - Node being considered.
 * @param hideUnevaluated - Large-page mode: drop nodes without visible===true.
 * @param visibilityEvaluated - True when a non-empty visibility map was applied.
 * @returns Whether the node itself is filtered out (children may still promote).
 */
function isSelfVisibilityDropped(
  root: TextSnapshotNode,
  hideUnevaluated: boolean,
  visibilityEvaluated: boolean,
): boolean {
  if (root.visible === false || root.offscreen === true) {
    return true;
  }
  if (visibilityEvaluated && root.visible !== true) {
    // Partial or full geometry pass: unevaluated nodes are not assumed visible.
    return true;
  }
  if (hideUnevaluated && root.visible !== true) {
    return true;
  }
  return false;
}

/**
 * Filters a tree, dropping hidden (and optionally offscreen) nodes.
 *
 * Why: Default snapshots should exclude anything the user cannot see; includeHidden
 * keeps them for debugging. When a node is dropped, visible descendants are
 * promoted to the nearest kept ancestor (menus inside display:none shells, etc.).
 *
 * @param root - Tree with visibility flags already applied (or stamped on skip).
 * @param includeHidden - When true, keep hidden and offscreen nodes.
 * @param hideUnevaluated - When true, nodes whose visibility was not evaluated
 *   (visible !== true) are dropped. On large pages, stampOptimisticDomVisibility
 *   runs first so real DOM nodes survive while AX-only decoration is dropped.
 * @param visibilityEvaluated - When true, a non-empty visibility map was applied
 *   and nodes without visible===true are dropped even if hideUnevaluated is false.
 * @returns Filtered tree, or undefined if the root itself is filtered out.
 * @throws Never throws.
 */
export function filterHidden(
  root: TextSnapshotNode,
  includeHidden: boolean,
  hideUnevaluated = false,
  visibilityEvaluated = false,
): TextSnapshotNode | undefined {
  const children: TextSnapshotNode[] = [];
  for (const child of root.children) {
    const kept = filterHidden(
      child,
      includeHidden,
      hideUnevaluated,
      visibilityEvaluated,
    );
    if (kept !== undefined) {
      children.push(kept);
    }
  }

  if (!includeHidden) {
    if (isSelfVisibilityDropped(root, hideUnevaluated, visibilityEvaluated)) {
      if (children.length === 0) {
        return undefined;
      }
      if (children.length === 1) {
        return children[0];
      }
      return {
        uid: root.uid,
        role: '__promoted__',
        name: '',
        children,
      };
    }
  }

  return {...root, children};
}

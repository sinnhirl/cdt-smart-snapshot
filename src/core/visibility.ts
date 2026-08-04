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
    if (root.backendNodeId !== undefined && infoByUid.size > 0) {
      return {
        ...root,
        children,
        visible: true,
        offscreen: false,
      };
    }
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
 * Filters a tree, dropping hidden (and optionally offscreen) nodes.
 *
 * Why: Default snapshots should exclude anything the user cannot see; includeHidden
 * keeps them for debugging. Children of dropped nodes are also dropped (no promotion).
 *
 * @param root - Tree with visibility flags already applied.
 * @param includeHidden - When true, keep hidden and offscreen nodes.
 * @param hideUnevaluated - When true, nodes whose visibility was not evaluated
 *   (visible !== true) are dropped UNLESS they have a backendNodeId (a real DOM
 *   handle — treat as visible since it paints). Used on large pages where
 *   per-node geometry collection is skipped: drops AX-only text/decoration
 *   nodes without nuking interactive DOM nodes.
 * @returns Filtered tree, or undefined if the root itself is filtered out.
 * @throws Never throws.
 */
export function filterHidden(
  root: TextSnapshotNode,
  includeHidden: boolean,
  hideUnevaluated = false,
): TextSnapshotNode | undefined {
  if (!includeHidden) {
    if (root.visible === false || root.offscreen === true) {
      return undefined;
    }
    if (
      hideUnevaluated &&
      root.visible !== true &&
      root.backendNodeId === undefined
    ) {
      return undefined;
    }
  }

  const children: TextSnapshotNode[] = [];
  for (const child of root.children) {
    const kept = filterHidden(child, includeHidden, hideUnevaluated);
    if (kept !== undefined) {
      children.push(kept);
    }
  }

  return {...root, children};
}

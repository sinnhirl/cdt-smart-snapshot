/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {describe, expect, it} from 'vitest';

import {
  applyVisibility,
  assessVisibility,
  filterHidden,
  stampOptimisticDomVisibility,
} from '../src/core/visibility.js';
import {runSmartSnapshotPipeline} from '../src/core/snapshot.js';
import type {ElementVisibilityInfo, TextSnapshotNode} from '../src/types.js';

/**
 * Builds a default in-viewport, visible element; override fields per case.
 * @param overrides - Partial fields to merge onto the default info.
 * @returns Complete ElementVisibilityInfo for assessVisibility.
 */
function makeInfo(
  overrides: Partial<ElementVisibilityInfo> & {
    rect?: Partial<ElementVisibilityInfo['rect']>;
  } = {},
): ElementVisibilityInfo {
  const baseRect = {
    top: 10,
    left: 10,
    bottom: 50,
    right: 100,
    width: 90,
    height: 40,
  };
  return {
    display: overrides.display ?? 'block',
    visibility: overrides.visibility ?? 'visible',
    opacity: overrides.opacity ?? 1,
    viewportWidth: overrides.viewportWidth ?? 1280,
    viewportHeight: overrides.viewportHeight ?? 720,
    rect: {
      ...baseRect,
      ...overrides.rect,
    },
  };
}

describe('assessVisibility', () => {
  it('shouldMarkDisplayNoneNodeAsHidden', () => {
    const result = assessVisibility(makeInfo({display: 'none'}));
    expect(result.visible).toBe(false);
    expect(result.offscreen).toBe(false);
  });

  it('shouldMarkVisibilityHiddenNodeAsHidden', () => {
    const result = assessVisibility(makeInfo({visibility: 'hidden'}));
    expect(result.visible).toBe(false);
    expect(result.offscreen).toBe(false);
  });

  it('shouldMarkZeroSizeNodeAsHidden', () => {
    const result = assessVisibility(
      makeInfo({
        rect: {width: 0, height: 0, top: 10, left: 10, bottom: 10, right: 10},
      }),
    );
    expect(result.visible).toBe(false);
    expect(result.offscreen).toBe(false);
  });

  it('shouldMarkOffscreenNodeAsOffscreenNotHidden', () => {
    // Below the fold: has size, but entirely outside the viewport.
    const result = assessVisibility(
      makeInfo({
        rect: {
          top: 800,
          left: 10,
          bottom: 850,
          right: 100,
          width: 90,
          height: 50,
        },
        viewportHeight: 720,
        viewportWidth: 1280,
      }),
    );
    expect(result.visible).toBe(true);
    expect(result.offscreen).toBe(true);
  });

  it('shouldMarkInViewportNodeAsVisible', () => {
    const result = assessVisibility(makeInfo());
    expect(result.visible).toBe(true);
    expect(result.offscreen).toBe(false);
  });
});

describe('filterHidden', () => {
  it('shouldTreatUndefinedVisibleAsHiddenByDefault', () => {
    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'Document',
      name: 'page',
      visible: true,
      children: [
        {
          uid: 2,
          role: 'button',
          name: 'Action',
          children: [],
        },
      ],
    };
    const filtered = filterHidden(tree, false, true);
    expect(filtered).toBeDefined();
    if (filtered !== undefined) {
      expect(filtered.children).toHaveLength(0);
    }
  });

  it('shouldKeepRootLineWhenRootVisibleAndVisibilityEvaluated', () => {
    // R3A regression: the page root (RootWebArea) was dropped when the
    // visibility map didn't include it (document handle threw on geometry
    // evaluation), so filterHidden replaced it with __promoted__ and the
    // page-title line vanished from every snapshot. A visible root must
    // survive even when visibilityEvaluated is true.
    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'RootWebArea',
      name: 'DeepSeek 开放平台',
      visible: true,
      children: [
        {
          uid: 2,
          role: 'menuitem',
          name: '用量信息',
          visible: true,
          children: [],
        },
      ],
    };
    const filtered = filterHidden(tree, false, false, true);
    expect(filtered).toBeDefined();
    if (filtered !== undefined) {
      expect(filtered.role).toBe('RootWebArea');
      expect(filtered.name).toBe('DeepSeek 开放平台');
      expect(filtered.children).toHaveLength(1);
    }
  });

  it('shouldKeepDomNodesOnLargePageSkipAfterOptimisticStamp', () => {
    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'Document',
      name: 'page',
      visible: true,
      children: [
        {
          uid: 2,
          role: 'button',
          name: 'Real DOM button',
          backendNodeId: 100,
          children: [],
        },
        {
          uid: 3,
          role: 'text',
          name: 'AX-only text',
          children: [],
        },
      ],
    };
    const stamped = stampOptimisticDomVisibility(tree);
    const filtered = filterHidden(stamped, false, true);
    expect(filtered).toBeDefined();
    if (filtered !== undefined) {
      expect(filtered.children).toHaveLength(1);
      expect(filtered.children[0]?.uid).toBe(2);
    }
  });

  it('shouldNotStampBodyTextAsVisibleOnLargePageSkip', () => {
    // ROUND3-1 regression: text/paragraph nodes carry backendNodeId (real DOM)
    // but have no interaction value. Stamping them optimistic-visible made
    // Wikipedia keep ~97% of chars (2.8% reduction). Only interactive roles
    // should be stamped; body text stays unevaluated and gets dropped by
    // hideUnevaluated on large pages.
    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'Document',
      name: 'wiki',
      visible: true,
      children: [
        {
          uid: 2,
          role: 'generic',
          name: '',
          backendNodeId: 200,
          children: [
            {
              uid: 3,
              role: 'text',
              name: 'long body paragraph text',
              backendNodeId: 301,
              children: [],
            },
            {
              uid: 4,
              role: 'paragraph',
              name: 'another paragraph',
              backendNodeId: 302,
              children: [],
            },
            {
              uid: 5,
              role: 'link',
              name: 'Talk',
              backendNodeId: 303,
              children: [],
            },
            {
              uid: 6,
              role: 'button',
              name: 'Edit',
              backendNodeId: 304,
              children: [],
            },
          ],
        },
      ],
    };
    const stamped = stampOptimisticDomVisibility(tree);
    const filtered = filterHidden(stamped, false, true);
    expect(filtered).toBeDefined();
    if (filtered !== undefined) {
      const kept = filtered.children[0]?.children ?? [];
      const keptRoles = kept.map(n => n.role).sort();
      // Body text/paragraph dropped; interactive link/button kept.
      expect(keptRoles).toEqual(['button', 'link']);
      expect(kept).toHaveLength(2);
    }
  });

  it('shouldDropUnevaluatedBackendNodeWhenHideUnevaluated', () => {
    // Large-page mode without optimistic stamp: unevaluated DOM nodes are not
    // assumed visible (hidden decoration with backendNodeId must not leak).
    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'Document',
      name: 'page',
      visible: true,
      children: [
        {
          uid: 2,
          role: 'button',
          name: 'Hidden shell',
          backendNodeId: 100,
          children: [],
        },
      ],
    };
    const filtered = filterHidden(tree, false, true);
    expect(filtered).toBeDefined();
    if (filtered !== undefined) {
      expect(filtered.children).toHaveLength(0);
    }
  });

  it('shouldDropNodeMissingFromPartialVisibilityMapWhenHideUnevaluatedFalse', () => {
    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'Document',
      name: 'page',
      visible: true,
      children: [
        {
          uid: 2,
          role: 'button',
          name: 'Collected',
          backendNodeId: 10,
          children: [],
        },
        {
          uid: 3,
          role: 'button',
          name: 'Failed collect',
          backendNodeId: 11,
          children: [],
        },
      ],
    };
    const infoByUid = new Map<number, ElementVisibilityInfo>([
      [
        2,
        makeInfo({
          display: 'block',
        }),
      ],
    ]);
    const withVis = applyVisibility(tree, infoByUid);
    const filtered = filterHidden(withVis, false, false, true);
    expect(filtered).toBeDefined();
    if (filtered !== undefined) {
      expect(filtered.children).toHaveLength(1);
      expect(filtered.children[0]?.uid).toBe(2);
    }
  });

  it('shouldPromoteVisibleChildWhenParentIsHidden', () => {
    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'Document',
      name: 'page',
      visible: true,
      children: [
        {
          uid: 2,
          role: 'generic',
          name: 'Hidden menu shell',
          visible: false,
          offscreen: false,
          children: [
            {
              uid: 3,
              role: 'button',
              name: 'Open menu',
              visible: true,
              offscreen: false,
              children: [],
            },
          ],
        },
      ],
    };
    const options = {
      maxDepth: 8,
      includeHidden: false,
      verbose: false,
    } as const;
    const result = runSmartSnapshotPipeline(tree, options);
    expect(result.formatted).toContain('[button] "Open menu"');
  });
});

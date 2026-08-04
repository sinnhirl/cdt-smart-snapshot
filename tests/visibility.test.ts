import {describe, expect, it} from 'vitest';

import {assessVisibility} from '../src/core/visibility.js';
import type {ElementVisibilityInfo} from '../src/types.js';

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

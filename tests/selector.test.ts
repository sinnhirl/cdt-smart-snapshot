/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {describe, expect, it} from 'vitest';

import {
  buildSelectorFromNode,
  type SelectorElement,
} from '../src/core/selector.js';

/**
 * Builds a mock DOM node for selector unit tests.
 *
 * @param spec - Node description.
 * @returns SelectorElement.
 */
function mockEl(spec: {
  tag: string;
  id?: string;
  classes?: string[];
  testId?: string;
  nthOfType?: number;
  parent?: SelectorElement | null;
}): SelectorElement {
  const classNames = spec.classes ?? [];
  const parent = spec.parent === undefined ? null : spec.parent;
  return {
    tagName: spec.tag.toUpperCase(),
    id: spec.id ?? '',
    classNames,
    nthOfType: spec.nthOfType ?? 1,
    parent,
    getAttribute(name: string): string | null {
      if (name === 'data-testid' && spec.testId !== undefined) {
        return spec.testId;
      }
      return null;
    },
  };
}

describe('selector', () => {
  it('shouldPreferDataTestidWhenUnique', () => {
    const el = mockEl({tag: 'button', testId: 'search-btn'});
    const selector = buildSelectorFromNode(el, sel => {
      if (sel === '[data-testid="search-btn"]') {
        return 1;
      }
      return 0;
    });
    expect(selector).toBe('[data-testid="search-btn"]');
  });

  it('shouldUseHashIdWhenUnique', () => {
    const el = mockEl({tag: 'button', id: 'search'});
    const selector = buildSelectorFromNode(el, sel => {
      if (sel === '#search') {
        return 1;
      }
      return 2;
    });
    expect(selector).toBe('#search');
  });

  it('shouldFallBackToClassChainWhenIdNotUnique', () => {
    const parent = mockEl({tag: 'div', classes: ['main-content']});
    const el = mockEl({
      tag: 'button',
      classes: ['submit-btn'],
      parent,
    });
    const selector = buildSelectorFromNode(el, sel => {
      if (sel === '#search') {
        return 2;
      }
      if (sel === 'div.main-content > button.submit-btn') {
        return 1;
      }
      return 0;
    });
    expect(selector).toBe('div.main-content > button.submit-btn');
  });

  it('shouldUseNthOfTypePathAsLastResort', () => {
    const body = mockEl({tag: 'body', nthOfType: 1});
    const div = mockEl({tag: 'div', nthOfType: 2, parent: body});
    const btn = mockEl({tag: 'button', nthOfType: 1, parent: div});
    const selector = buildSelectorFromNode(btn, sel => {
      if (sel.includes('nth-of-type')) {
        return 1;
      }
      return 2;
    });
    expect(selector).toContain('nth-of-type');
    expect(selector).toContain('button:nth-of-type(1)');
  });

  it('shouldDegradeWhenQuerySelectorAllReportsMultipleMatches', () => {
    const el = mockEl({tag: 'button', testId: 'dup'});
    const selector = buildSelectorFromNode(el, sel => {
      if (sel.startsWith('[data-testid')) {
        return 2;
      }
      if (sel === 'button') {
        return 1;
      }
      return 0;
    });
    expect(selector).toBe('button');
  });
});

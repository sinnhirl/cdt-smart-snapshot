/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * CSS selector generation from a DOM element (pure, testable slice of browser logic).
 *
 * Why: Official CDP MCP tools need stable selectors; verifying uniqueness via
 * querySelectorAll count mirrors chrome-devtools-mcp and keeps failures explicit.
 */

/**
 * Minimal element shape for selector strategies (mocked in unit tests).
 */
export interface SelectorElement {
  tagName: string;
  id: string;
  classNames: string[];
  nthOfType: number;
  parent: SelectorElement | null;
  /**
   * Reads an attribute (data-testid, etc.).
   *
   * @param name - Attribute name.
   * @returns Value or null.
   */
  getAttribute(name: string): string | null;
}

/**
 * Counts how many nodes match a selector (injected for tests and browser evaluate).
 */
export type SelectorMatchCount = (selector: string) => number;

/**
 * Returns a lower-case tag name for CSS.
 *
 * @param el - Element.
 * @returns Tag such as `button`.
 */
export function tagCss(el: SelectorElement): string {
  return el.tagName.toLowerCase();
}

/**
 * Builds a class suffix such as `.foo.bar` (empty when no classes).
 *
 * @param el - Element.
 * @returns Class selector fragment.
 */
export function classSuffix(el: SelectorElement): string {
  if (el.classNames.length === 0) {
    return '';
  }
  const parts: string[] = [];
  for (const cls of el.classNames) {
    if (cls.length > 0) {
      parts.push(`.${cls}`);
    }
  }
  return parts.join('');
}

/**
 * Returns the first selector that matches exactly one node, or undefined.
 *
 * @param candidates - Ordered strategies.
 * @param countMatches - Uniqueness check.
 * @returns Unique selector or undefined.
 */
export function firstUnique(
  candidates: string[],
  countMatches: SelectorMatchCount,
): string | undefined {
  for (const sel of candidates) {
    if (sel.length > 0 && countMatches(sel) === 1) {
      return sel;
    }
  }
  return undefined;
}

/**
 * Builds an nth-of-type chain from the element up to html.
 *
 * @param el - Target element.
 * @returns Selector such as `html > body > div:nth-of-type(2)`.
 */
export function buildNthOfTypeChain(el: SelectorElement): string {
  const segments: string[] = [];
  let current: SelectorElement | null = el;
  while (current !== null) {
    const tag = tagCss(current);
    segments.unshift(`${tag}:nth-of-type(${String(current.nthOfType)})`);
    current = current.parent;
  }
  return segments.join(' > ');
}

/**
 * Attempts a upward class chain selector for the element.
 *
 * @param el - Target element.
 * @returns Candidate selector or empty string.
 */
export function buildClassChain(el: SelectorElement): string {
  const segments: string[] = [];
  let current: SelectorElement | null = el;
  while (current !== null) {
    const tag = tagCss(current);
    segments.unshift(`${tag}${classSuffix(current)}`);
    current = current.parent;
  }
  return segments.join(' > ');
}

/**
 * Generates a unique CSS selector for an element using MCP-style heuristics.
 *
 * Why: data-testid and unique ids are cheapest for agents; class and nth-of-type
 * chains are fallbacks when attributes collide.
 *
 * @param el - Target element (mock or live DOM adapter).
 * @param countMatches - Returns document.querySelectorAll(selector).length.
 * @returns Unique selector string, or undefined when none verified.
 * @throws Never throws.
 */
export function buildSelectorFromNode(
  el: SelectorElement,
  countMatches: SelectorMatchCount,
): string | undefined {
  const testId = el.getAttribute('data-testid');
  if (testId !== null && testId.length > 0) {
    const byTestId = `[data-testid="${testId}"]`;
    const unique = firstUnique([byTestId], countMatches);
    if (unique !== undefined) {
      return unique;
    }
  }

  if (el.id.length > 0) {
    const byId = `#${el.id}`;
    const unique = firstUnique([byId], countMatches);
    if (unique !== undefined) {
      return unique;
    }
  }

  const classChain = buildClassChain(el);
  if (classChain.length > 0) {
    const unique = firstUnique([classChain], countMatches);
    if (unique !== undefined) {
      return unique;
    }
  }

  const tagOnly = tagCss(el);
  const tagUnique = firstUnique([tagOnly], countMatches);
  if (tagUnique !== undefined) {
    return tagUnique;
  }

  const nthChain = buildNthOfTypeChain(el);
  return firstUnique([nthChain], countMatches);
}

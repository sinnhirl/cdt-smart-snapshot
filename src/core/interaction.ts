/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Interaction / semantic-role filtering for snapshot trees.
 *
 * Why: Most AX nodes are layout chrome (generic, listitem, paragraph). Keeping
 * only interactive and meaningful roles is the largest single token win for agents.
 */

import type {TextSnapshotNode} from '../types.js';

/** Roles always kept (interactive controls and key landmarks). */
const ALWAYS_KEEP: ReadonlySet<string> = new Set([
  'button',
  'link',
  'input',
  'checkbox',
  'radio',
  'combobox',
  'textbox',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'slider',
  'spinbutton',
  'searchbox',
  'dialog',
  'alert',
  'alertdialog',
  'article',
  'heading',
  'table',
  'row',
  'cell',
  'banner',
  'main',
  'navigation',
  'Document',
  'RootWebArea',
  'WebArea',
]);

/** Roles that are pure containers: never emitted; children are promoted. */
const COLLAPSE_ROLES: ReadonlySet<string> = new Set([
  'group',
  'generic',
  'list',
  'listitem',
  'paragraph',
  'complementary',
  'contentinfo',
  'form',
  'section',
  'InlineTextBox',
  'LineBreak',
]);

/**
 * Returns true when a role+name pair should appear in the non-verbose snapshot.
 *
 * Why: Role alone is not enough — img/text/region without a name add noise;
 * with a name they are meaningful landmarks or labels agents need.
 *
 * @param role - AX role string.
 * @param name - Accessible name (may be empty).
 * @returns True if the node should be kept as its own output line.
 * @throws Never throws.
 */
export function isInteractiveRole(role: string, name: string): boolean {
  const trimmed = name.trim();

  if (ALWAYS_KEEP.has(role)) {
    return true;
  }

  // img with a name is meaningful; unnamed decorative images are noise.
  // Chrome's AX tree reports the role as 'image' (ARIA img maps here),
  // not the historical 'img', so accept both.
  if (
    (role === 'img' || role === 'image') &&
    trimmed.length > 0
  ) {
    return true;
  }

  // text / StaticText with non-empty name carries content agents read.
  if ((role === 'text' || role === 'StaticText') && trimmed.length > 0) {
    return true;
  }

  // region (and similar landmarks) only when named — unnamed ones are containers.
  if (role === 'region' && trimmed.length > 0) {
    return true;
  }

  return false;
}

/**
 * Returns true when the role should be collapsed (children promoted, self omitted).
 *
 * @param role - AX role string.
 * @param name - Accessible name.
 * @returns True if this node is a pure container under non-verbose mode.
 * @throws Never throws.
 */
export function shouldCollapseRole(role: string, name: string): boolean {
  if (COLLAPSE_ROLES.has(role)) {
    return true;
  }
  // Unnamed region acts as a container.
  if (role === 'region' && name.trim().length === 0) {
    return true;
  }
  return false;
}

/**
 * Roles whose accessible name already contains their visible label, so text
 * children are redundant and folded in non-verbose mode.
 *
 * Why: On label-heavy pages (Baidu/Zhihu — mostly link+text-child trees), a
 * link's accessible name already carries the label; its text/StaticText
 * children only duplicate it and inflate output (measured +15% chars, making
 * smart output larger than official — negative reduction). Self-labeling
 * controls fold those children; controls that expose dynamic values (textbox
 * typed input, combobox selection) keep them.
 */
const SELF_LABELING_CONTROLS: ReadonlySet<string> = new Set([
  'link',
  'button',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
]);

/**
 * Filters a tree to interactive / meaningful nodes; collapses container roles.
 *
 * Why: Collapsing (promoting children) preserves DOM order of interactive nodes
 * without emitting useless wrapper lines that inflate token counts.
 *
 * @param root - Input snapshot tree.
 * @param verbose - When true, keep container/static roles instead of collapsing.
 * @returns Filtered tree, or undefined if nothing remains.
 * @throws Never throws.
 */
export function filterByInteraction(
  root: TextSnapshotNode,
  verbose: boolean,
): TextSnapshotNode | undefined {
  const filteredChildren: TextSnapshotNode[] = [];
  for (const child of root.children) {
    const kept = filterByInteraction(child, verbose);
    if (kept !== undefined) {
      // If a child was a collapsed container represented as a synthetic wrapper,
      // its children may already be promoted inside `kept`.
      filteredChildren.push(kept);
    }
  }

  if (verbose) {
    return {...root, children: filteredChildren};
  }

  // Self-labeling controls (link/button/...) carry their text in the name;
  // fold redundant text/StaticText children so label-heavy pages don't bloat.
  // Defensive: only fold when the control actually has a name — a nameless
  // control may rely on its text child for its label, folding would swallow it.
  const finalChildren =
    SELF_LABELING_CONTROLS.has(root.role) && root.name.trim().length > 0
      ? filteredChildren.filter(
          c => c.role !== 'text' && c.role !== 'StaticText',
        )
      : filteredChildren;

  if (shouldCollapseRole(root.role, root.name)) {
    // Promote children: return a synthetic holder only when we need a single root.
    // Callers that receive a collapsed root with multiple promoted children get
    // a placeholder role "__promoted__" that formatters should flatten.
    if (filteredChildren.length === 0) {
      return undefined;
    }
    if (filteredChildren.length === 1) {
      const only = filteredChildren[0];
      if (only !== undefined) {
        return only;
      }
      return undefined;
    }
    // Multiple promoted children — wrap so the tree stays single-rooted.
    // The wrapper uses a private role that formatTree skips (see snapshot.ts).
    return {
      uid: root.uid,
      role: '__promoted__',
      name: '',
      children: filteredChildren,
    };
  }

  if (!isInteractiveRole(root.role, root.name)) {
    // Unknown non-interactive role: promote children if any, else drop.
    if (filteredChildren.length === 0) {
      return undefined;
    }
    if (filteredChildren.length === 1) {
      const only = filteredChildren[0];
      if (only !== undefined) {
        return only;
      }
      return undefined;
    }
    return {
      uid: root.uid,
      role: '__promoted__',
      name: '',
      children: filteredChildren,
    };
  }

  return {...root, children: finalChildren};
}

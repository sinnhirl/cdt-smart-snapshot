/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * smart_snapshot main pipeline: visibility → interaction → dedupe → prune → format.
 *
 * Why: Four independent filters compose cleanly; keeping them ordered and pure
 * makes each stage unit-testable and lets tools stay thin.
 */

import type {
  ElementVisibilityInfo,
  SnapshotOptions,
  TextSnapshotNode,
} from '../types.js';
import {dedupeTree, collapseSameNameChildren} from './dedupe.js';
import {filterByInteraction} from './interaction.js';
import {pruneTree} from './prune.js';
import {applyVisibility, filterHidden} from './visibility.js';

/**
 * Formats a processed snapshot tree into the SPEC indented text representation.
 *
 * Why: Agents consume text, not JSON — a compact role/name/uid line per node is
 * the whole point of token-efficient snapshots.
 *
 * @param root - Processed tree (after pipelines).
 * @param indent - Current indent level (spaces = indent * 2).
 * @returns Multiline formatted string.
 * @throws Never throws.
 */
export function formatTree(root: TextSnapshotNode, indent = 0): string {
  // Synthetic promotion wrappers from interaction filter are transparent.
  if (root.role === '__promoted__') {
    const parts: string[] = [];
    for (const child of root.children) {
      const text = formatTree(child, indent);
      if (text.length > 0) {
        parts.push(text);
      }
    }
    return parts.join('\n');
  }

  const pad = '  '.repeat(indent);
  const line = formatNodeLine(root);
  const lines: string[] = [`${pad}${line}`];

  if (root.collapsed === true) {
    // Collapsed nodes are leaves in the formatted output.
    return lines.join('\n');
  }

  for (const child of root.children) {
    const childText = formatTree(child, indent + 1);
    if (childText.length > 0) {
      lines.push(childText);
    }
  }
  return lines.join('\n');
}

/**
 * Formats a single node into one SPEC line.
 *
 * @param node - Node to format.
 * @returns Line such as `[button] "OK" (uid=12)` or `[+] "name" (N child nodes, uid=M)`.
 */
function formatNodeLine(node: TextSnapshotNode): string {
  if (node.collapsed === true) {
    const label = node.name.length > 0 ? `"${node.name}"` : `"${node.role}"`;
    const count = node.childCount ?? 0;
    return `[+] ${label} (${String(count)} child nodes, uid=${String(node.uid)})`;
  }

  const namePart = node.name.length > 0 ? ` "${node.name}"` : '';
  // Document / RootWebArea often show the page title without quotes+uid noise preference:
  // SPEC example: `[Document] example.com` — name without quotes for Document-like roles.
  if (
    (node.role === 'Document' ||
      node.role === 'RootWebArea' ||
      node.role === 'WebArea') &&
    node.name.length > 0
  ) {
    const uidPart =
      node.children.length === 0 ? ` (uid=${String(node.uid)})` : '';
    return `[${node.role}] ${node.name}${uidPart}`;
  }

  const countPart =
    node.count !== undefined && node.count > 1 ? ` ×${String(node.count)}` : '';
  const uidPart = ` (uid=${String(node.uid)})`;

  // Spec sample shows some landmarks without uid when they are structural; we always
  // include uid for interactive nodes so agents can act. For text without interaction
  // need, uid is still useful for diff — keep it.
  if (node.role === 'text' || node.role === 'StaticText') {
    return `[text]${namePart}${countPart}`;
  }

  return `[${node.role}]${namePart}${countPart}${uidPart}`;
}

/**
 * Result of running the full smart-snapshot pipeline.
 */
export interface SmartSnapshotResult {
  /** Processed tree (post all filters). */
  root: TextSnapshotNode;
  /**
   * Tree BEFORE dedupe/collapse — the diff baseline.
   *
   * Why: diff identity is uid-based. Dedupe merges siblings into one uid and
   * collapse folds same-name chains, so those uids vanish from `root` and a
   * later snapshot_diff would report spurious removed/added for them. Storing
   * the pre-dedupe tree as the diff baseline keeps every real node's uid
   * stable across snapshots.
   */
  diffRoot: TextSnapshotNode;
  /** Formatted text for MCP response. */
  formatted: string;
}

/**
 * Runs visibility → interaction → dedupe → prune and formats the result.
 *
 * Why: Order matters — drop invisible first (cheapest semantic cut), then role
 * filter, then merge duplicates, then depth-limit. Formatting last keeps stages pure.
 *
 * @param root - Normalized AX tree (uids already assigned).
 * @param options - Snapshot options (maxDepth, includeHidden, verbose).
 * @param visibilityInfo - Optional uid → geometry map; when provided, applied first.
 * @returns Processed root and formatted text.
 * @throws Never throws. Empty trees format to a minimal Document line.
 */
export function runSmartSnapshotPipeline(
  root: TextSnapshotNode,
  options: SnapshotOptions,
  visibilityInfo?: Map<number, ElementVisibilityInfo>,
): SmartSnapshotResult {
  let tree = root;

  if (visibilityInfo !== undefined) {
    tree = applyVisibility(tree, visibilityInfo);
  }

  const afterVisibility = filterHidden(tree, options.includeHidden);
  if (afterVisibility === undefined) {
    const empty: TextSnapshotNode = {
      uid: root.uid,
      role: 'Document',
      name: '',
      children: [],
    };
    return {root: empty, diffRoot: empty, formatted: formatTree(empty)};
  }
  tree = afterVisibility;

  const afterInteraction = filterByInteraction(tree, options.verbose);
  if (afterInteraction === undefined) {
    const empty: TextSnapshotNode = {
      uid: root.uid,
      role: 'Document',
      name: root.name,
      children: [],
    };
    return {root: empty, diffRoot: empty, formatted: formatTree(empty)};
  }
  tree = afterInteraction;

  // Diff baseline = the tree before dedupe/collapse/prune (see diffRoot doc).
  const diffRoot = tree;

  tree = dedupeTree(tree);
  // Collapse same-name child chains (SPA nav shells) before depth-limiting.
  tree = collapseSameNameChildren(tree);
  tree = pruneTree(tree, options.maxDepth);

  return {root: tree, diffRoot, formatted: formatTree(tree)};
}

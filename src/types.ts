/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Shared types for the smart-snapshot pipeline.
 * Kept free of runtime deps so core pure functions and tests can import freely.
 */

/**
 * A normalized accessibility node used throughout the snapshot pipeline.
 * `uid` is a stable numeric id (via backendNodeId mapping) so diffs can
 * recognize the same element across consecutive snapshots.
 */
export interface TextSnapshotNode {
  /** Stable id assigned by the uid mapper. */
  uid: number;
  /** AX role string (e.g. button, link, text). */
  role: string;
  /** Accessible name; empty string when absent. */
  name: string;
  /** Optional AX value (inputs, checkboxes, etc.). */
  value?: string;
  /** Chromium backend node id when available from the AX tree. */
  backendNodeId?: number;
  /** Child nodes in DOM/AX order. */
  children: TextSnapshotNode[];
  /**
   * Whether the node is painted and has non-zero size.
   * Undefined until visibility assessment runs.
   */
  visible?: boolean;
  /**
   * Whether the node has size but lies outside the viewport.
   * Distinct from hidden so includeHidden can retain offscreen nodes.
   */
  offscreen?: boolean;
  /**
   * Merge count from dedupe: consecutive same role+name siblings collapsed into ×N.
   * Undefined or 1 means a single node.
   */
  count?: number;
  /**
   * True when prune collapsed this node's subtree past maxDepth into a summary.
   */
  collapsed?: boolean;
  /**
   * Number of direct children reported in a collapsed summary line.
   */
  childCount?: number;
}

/**
 * Options controlling the smart_snapshot / snapshot_diff pipelines.
 */
export interface SnapshotOptions {
  /** Maximum tree depth before subtrees collapse into a summary line. */
  maxDepth: number;
  /** When true, retain hidden/offscreen nodes (for debugging). */
  includeHidden: boolean;
  /** When true, keep container/static roles that are normally collapsed. */
  verbose: boolean;
}

/**
 * Geometric and CSS facts for one DOM element, collected via page.evaluate.
 * Core visibility logic stays pure by consuming this shape instead of puppeteer.
 */
export interface ElementVisibilityInfo {
  display: string;
  visibility: string;
  opacity: number;
  rect: BoundingRect;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * DOM getBoundingClientRect()-style rectangle.
 */
export interface BoundingRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

/**
 * Result of assessing a single element's visibility.
 */
export interface VisibilityState {
  /**
   * True when the element is not CSS-hidden and has non-zero size.
   * Offscreen elements can still be visible=true.
   */
  visible: boolean;
  /**
   * True when the element has size but lies entirely outside the viewport.
   */
  offscreen: boolean;
}

/**
 * A raw AX node shape as returned by page.accessibility.snapshot (subset we use).
 * Kept puppeteer-free so ax-tree.ts remains a pure normalizer.
 */
export interface RawAxNode {
  role?: string | {value: string};
  name?: string | {value: string};
  value?: string | number | boolean | {value: string | number | boolean};
  backendDOMNodeId?: number;
  ignored?: boolean;
  children?: RawAxNode[];
}

/**
 * One line of a snapshot diff (added / removed / changed).
 */
export interface DiffEntry {
  kind: 'added' | 'removed' | 'changed';
  node: TextSnapshotNode;
  /** Previous node when kind === 'changed'. */
  previous?: TextSnapshotNode;
  /** Human-readable change detail (e.g. name "a" → "b"). */
  detail?: string;
}

/**
 * Full result of comparing two snapshots.
 */
export interface DiffResult {
  /** True when no differences were found. */
  identical: boolean;
  /** Diff entries in DOM order. */
  entries: DiffEntry[];
  /** Formatted text ready to return to the MCP client. */
  text: string;
}

/**
 * In-memory previous snapshot used by snapshot_diff.
 */
export interface StoredSnapshot {
  /** Root of the processed snapshot tree. */
  root: TextSnapshotNode;
  /** uid → node map for O(1) lookups during diff. */
  byUid: Map<number, TextSnapshotNode>;
  /** Formatted tree text from the last smart_snapshot / initial diff. */
  formatted: string;
}

/**
 * MCP tool call result shape (subset of CallToolResult).
 */
export interface ToolTextResult {
  content: Array<{type: 'text'; text: string}>;
  isError?: boolean;
}

/**
 * Configuration loaded from environment variables.
 */
export interface AppConfig {
  /** Prefer explicit WebSocket endpoint when set. */
  wsEndpoint: string | undefined;
  /** HTTP browserURL for puppeteer.connect (default http://127.0.0.1:9222). */
  browserURL: string;
  /** Directory where screenshots are written. */
  screenshotDir: string;
  /** Default maxDepth for snapshots. */
  defaultMaxDepth: number;
}

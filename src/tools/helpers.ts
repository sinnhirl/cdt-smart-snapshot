/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Shared helpers for MCP tool modules.
 */

import type {
  ElementVisibilityInfo,
  TextSnapshotNode,
  ToolTextResult,
} from '../types.js';

/**
 * Builds a successful text tool result.
 *
 * @param text - Response body.
 * @returns ToolTextResult.
 * @throws Never throws.
 */
export function textResult(text: string): ToolTextResult {
  return {content: [{type: 'text', text}]};
}

/**
 * Builds an error tool result (isError: true).
 *
 * @param text - Error message.
 * @returns ToolTextResult with isError.
 * @throws Never throws.
 */
export function errorResult(text: string): ToolTextResult {
  return {content: [{type: 'text', text}], isError: true};
}

/**
 * Extracts an Error message from unknown.
 *
 * @param err - Caught value.
 * @returns Message string.
 * @throws Never throws.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Remaps visibility info from backendNodeId keys to uid keys using the tree.
 *
 * @param root - Normalized tree with backendNodeId and uid populated.
 * @param byBackendId - Visibility map from browser.ts.
 * @returns Map keyed by uid for the visibility pipeline.
 * @throws Never throws.
 */
export function remapVisibilityToUid(
  root: TextSnapshotNode,
  byBackendId: Map<number, ElementVisibilityInfo>,
): Map<number, ElementVisibilityInfo> {
  const byUid = new Map<number, ElementVisibilityInfo>();
  const queue: TextSnapshotNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    if (node.backendNodeId !== undefined) {
      const info = byBackendId.get(node.backendNodeId);
      if (info !== undefined) {
        byUid.set(node.uid, info);
      }
    }
    for (const child of node.children) {
      queue.push(child);
    }
  }
  return byUid;
}

/**
 * JSON Schema object type for MCP tool inputSchema (no zod cast needed).
 */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<
    string,
    Record<string, string | number | boolean | string[] | undefined>
  >;
  required?: string[];
}

/**
 * MCP tool definition shape for tools/list.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

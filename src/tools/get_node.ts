/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * get_node MCP tool — detailed view of one uid from the last snapshot.
 */

import {z} from 'zod';

import {
  getActivePage,
  getLastConnectError,
  queryDomByBackendNodeId,
} from '../browser.js';
import {lookupIndex} from '../core/uid-index.js';
import type {ToolTextResult} from '../types.js';
import {
  errorResult,
  textResult,
  toErrorMessage,
  type ToolDefinition,
} from './helpers.js';
import {isToolError, requireSnapshotUidIndex} from './query-helpers.js';

/** Zod schema for get_node arguments. */
export const getNodeArgsSchema = z.object({
  uid: z.number().int().positive(),
});

/** Tool metadata for tools/list. */
export const getNodeDefinition: ToolDefinition = {
  name: 'get_node',
  description:
    'Return role, path, DOM geometry, and CSS selector for one snapshot uid. Requires a prior smart_snapshot or snapshot_diff.',
  inputSchema: {
    type: 'object',
    properties: {
      uid: {
        type: 'number',
        description: 'Stable uid from the snapshot output.',
        minimum: 1,
      },
    },
    required: ['uid'],
  },
};

/**
 * Executes get_node for one uid.
 *
 * @param args - Raw tool arguments.
 * @returns MCP text result.
 * @throws Never throws — errors are returned as isError results.
 */
export async function handleGetNode(
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  try {
    const parsed = getNodeArgsSchema.parse(args ?? {});
    const {page, url} = await getActivePage();
    const cacheOrError = requireSnapshotUidIndex(url);
    if (isToolError(cacheOrError)) {
      return cacheOrError;
    }

    const entry = lookupIndex(cacheOrError.index, parsed.uid);
    if (entry === undefined) {
      return errorResult(
        `uid ${String(parsed.uid)} not found in the current snapshot. Call smart_snapshot or snapshot_diff to refresh the index.`,
      );
    }

    const namePart =
      entry.name.length > 0 ? `"${entry.name}"` : '';
    const lines: string[] = [
      `uid=${String(entry.uid)} [${entry.role}] ${namePart}`.trimEnd(),
      `path: ${entry.path}`,
      `childCount: ${String(entry.childCount)}`,
    ];

    if (entry.backendNodeId === undefined) {
      lines.push('domState: unavailable');
      return textResult(lines.join('\n'));
    }

    const dom = await queryDomByBackendNodeId(page, entry.backendNodeId);
    if (dom === undefined) {
      lines.push('domState: unavailable');
      return textResult(lines.join('\n'));
    }

    if (dom.value !== undefined) {
      lines.push(`value: ${dom.value}`);
    }
    if (dom.checked !== undefined) {
      lines.push(`checked: ${dom.checked ? 'true' : 'false'}`);
    }
    if (dom.placeholder !== undefined) {
      lines.push(`placeholder: "${dom.placeholder}"`);
    }
    if (dom.disabled !== undefined) {
      lines.push(`disabled: ${dom.disabled ? 'true' : 'false'}`);
    }
    lines.push(`cssSelector: ${dom.cssSelector}`);
    if (dom.rect !== undefined) {
      lines.push(
        `rect: {top: ${String(dom.rect.top)}, left: ${String(dom.rect.left)}, width: ${String(dom.rect.width)}, height: ${String(dom.rect.height)}}`,
      );
    }
    lines.push(`visible: ${dom.visible ? 'true' : 'false'}`);
    return textResult(lines.join('\n'));
  } catch (err) {
    const last = getLastConnectError();
    if (last !== undefined) {
      return errorResult(last);
    }
    return errorResult(toErrorMessage(err));
  }
}

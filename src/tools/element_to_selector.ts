/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * element_to_selector MCP tool — resolve uid to a unique CSS selector.
 */

import {z} from 'zod';

import {
  elementToSelector,
  getActivePage,
  getLastConnectError,
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

/** Zod schema for element_to_selector arguments. */
export const elementToSelectorArgsSchema = z.object({
  uid: z.number().int().positive(),
});

/** Tool metadata for tools/list. */
export const elementToSelectorDefinition: ToolDefinition = {
  name: 'element_to_selector',
  description:
    'Return a unique CSS selector for a snapshot uid (for chrome-devtools-mcp click/fill). Requires smart_snapshot or snapshot_diff first.',
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
 * Executes element_to_selector for one uid.
 *
 * @param args - Raw tool arguments.
 * @returns MCP text result (single-line selector on success).
 * @throws Never throws — errors are returned as isError results.
 */
export async function handleElementToSelector(
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  try {
    const parsed = elementToSelectorArgsSchema.parse(args ?? {});
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

    if (entry.backendNodeId === undefined) {
      return errorResult(
        `Could not resolve uid ${String(parsed.uid)} to a DOM element. The page may have navigated; call smart_snapshot again.`,
      );
    }

    const selector = await elementToSelector(page, entry.backendNodeId);
    if (selector === undefined || selector.length === 0) {
      return errorResult(
        `Could not resolve uid ${String(parsed.uid)} to a DOM element. The page may have navigated; call smart_snapshot again.`,
      );
    }

    return textResult(selector);
  } catch (err) {
    const last = getLastConnectError();
    if (last !== undefined) {
      return errorResult(last);
    }
    return errorResult(toErrorMessage(err));
  }
}

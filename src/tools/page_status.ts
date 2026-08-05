/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * page_status MCP tool — URL, loading state, and recent console/errors.
 */

import {z} from 'zod';

import type {DiagnosticEntry} from '../browser.js';
import {
  clearPageDiagnostics,
  getActivePage,
  getLastConnectError,
  getPageDiagnostics,
  readPageLifecycle,
} from '../browser.js';
import type {ToolTextResult} from '../types.js';
import {
  errorResult,
  textResult,
  toErrorMessage,
  type ToolDefinition,
} from './helpers.js';

/** Zod schema for page_status arguments. */
export const pageStatusArgsSchema = z.object({
  clear: z
    .boolean()
    .default(false)
    .describe('Clear accumulated console/error buffers after returning.'),
});

/** Tool metadata for tools/list. */
export const pageStatusDefinition: ToolDefinition = {
  name: 'page_status',
  description:
    'Report current page URL, title, readyState, loading flag, and recent console errors, page exceptions, and failed network requests.',
  inputSchema: {
    type: 'object',
    properties: {
      clear: {
        type: 'boolean',
        description:
          'When true, clear diagnostic buffers after returning this status.',
        default: false,
      },
    },
  },
};

/**
 * Formats milliseconds ago as a human-readable age string.
 *
 * R4-5: format is locked by unit test so it cannot drift from the spec
 * examples (`2 min ago` style: "<n> <unit> ago").
 *
 * @param timestampMs - Epoch ms when the event occurred.
 * @returns String such as `2 min ago`.
 */
export function formatAge(timestampMs: number): string {
  const deltaSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (deltaSec < 60) {
    return `${String(deltaSec)} sec ago`;
  }
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) {
    return `${String(mins)} min ago`;
  }
  const hours = Math.floor(mins / 60);
  return `${String(hours)} hr ago`;
}

/**
 * Formats one diagnostic section or `(None)`.
 *
 * @param title - Section heading.
 * @param entries - Buffered entries.
 * @returns Lines for the section.
 */
function formatDiagnosticSection(
  title: string,
  entries: DiagnosticEntry[],
): string[] {
  const lines: string[] = [title];
  if (entries.length === 0) {
    lines.push('  (None)');
    return lines;
  }
  for (const entry of entries) {
    const prefix =
      entry.level === 'warn'
        ? '[warn]'
        : entry.level === 'pageerror'
          ? '[exception]'
          : entry.level === 'request'
            ? '[failed]'
            : '[error]';
    lines.push(
      `  - ${prefix} ${entry.message} (${formatAge(entry.timestampMs)})`,
    );
  }
  return lines;
}

/**
 * Executes page_status on the active browser page.
 *
 * @param args - Raw tool arguments.
 * @returns MCP text result.
 * @throws Never throws — errors are returned as isError results.
 */
export async function handlePageStatus(
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  try {
    const parsed = pageStatusArgsSchema.parse(args ?? {});
    const {page} = await getActivePage();
    const lifecycle = await readPageLifecycle(page);
    const diagnostics = getPageDiagnostics(page, 5);

    const lines: string[] = [
      `URL: ${lifecycle.url}`,
      `Title: ${lifecycle.title}`,
      `readyState: ${lifecycle.readyState}`,
      `loading: ${lifecycle.loading ? 'true' : 'false'}`,
      ...formatDiagnosticSection(
        // R4-6: buffer keeps error + warn (more signal); title says messages.
        'Console messages (recent 5, error+warn):',
        diagnostics.consoleErrors,
      ),
      ...formatDiagnosticSection(
        'Page exceptions (recent 3):',
        diagnostics.pageExceptions.slice(-3),
      ),
      ...formatDiagnosticSection(
        'Failed requests (recent 5):',
        diagnostics.failedRequests,
      ),
    ];

    if (parsed.clear) {
      clearPageDiagnostics(page);
    }

    return textResult(lines.join('\n'));
  } catch (err) {
    const last = getLastConnectError();
    if (last !== undefined) {
      return errorResult(last);
    }
    return errorResult(toErrorMessage(err));
  }
}

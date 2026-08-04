/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * screenshot_to_disk MCP tool — save screenshot to disk, return path only.
 */

import {randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

import {z} from 'zod';

import {getActivePage, takeScreenshotToPath} from '../browser.js';
import {loadConfig} from '../config.js';
import type {ToolTextResult} from '../types.js';
import {
  errorResult,
  textResult,
  toErrorMessage,
  type ToolDefinition,
} from './helpers.js';

/** Zod schema for screenshot_to_disk arguments. */
export const screenshotArgsSchema = z.object({
  format: z.enum(['png', 'jpeg']).default('png').describe('Screenshot format.'),
  quality: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(80)
    .describe('JPEG quality (ignored for PNG).'),
  fullPage: z
    .boolean()
    .default(false)
    .describe('If true, capture the full scrollable page.'),
  directory: z
    .string()
    .optional()
    .describe(
      'Output directory override. Defaults to config screenshotDir (system temp).',
    ),
});

/** Tool metadata for tools/list. */
export const screenshotToDiskDefinition: ToolDefinition = {
  name: 'screenshot_to_disk',
  description:
    'Takes a screenshot, saves it to disk, and returns the file path. Saves ~3000-5000 tokens per screenshot compared to returning base64. Read the file with read_file if you need to inspect it.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'Screenshot format.',
        default: 'png',
      },
      quality: {
        type: 'number',
        description: 'JPEG quality (ignored for PNG).',
        minimum: 0,
        maximum: 100,
        default: 80,
      },
      fullPage: {
        type: 'boolean',
        description: 'If true, capture the full scrollable page.',
        default: false,
      },
      directory: {
        type: 'string',
        description:
          'Output directory override. Defaults to config screenshotDir (system temp).',
      },
    },
  },
};

/**
 * Builds a screenshot filename: YYYYMMDD_HHMMSS_<6hex>.<ext>
 *
 * @param format - File extension without dot.
 * @param now - Timestamp (injectable for tests).
 * @param randomHex - 6-char hex (injectable for tests).
 * @returns Filename string.
 * @throws Never throws.
 */
export function buildScreenshotFilename(
  format: 'png' | 'jpeg',
  now: Date = new Date(),
  randomHex: string = randomBytes(3).toString('hex'),
): string {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ext = format === 'jpeg' ? 'jpeg' : 'png';
  return `${y}${m}${d}_${hh}${mm}${ss}_${randomHex}.${ext}`;
}

/**
 * Executes screenshot_to_disk against the active browser page.
 *
 * @param args - Raw tool arguments (validated via zod).
 * @returns MCP text result with the saved file path.
 * @throws Never throws — errors are returned as isError results.
 */
export async function handleScreenshotToDisk(
  args: Record<string, unknown> | undefined,
): Promise<ToolTextResult> {
  try {
    const parsed = screenshotArgsSchema.parse(args ?? {});
    const config = loadConfig();
    const directory = parsed.directory ?? config.screenshotDir;

    await mkdir(directory, {recursive: true});

    const filename = buildScreenshotFilename(parsed.format);
    const filePath = join(directory, filename);

    const {page} = await getActivePage();
    await takeScreenshotToPath(
      page,
      filePath,
      parsed.format,
      parsed.quality,
      parsed.fullPage,
    );

    return textResult(`Screenshot saved to: ${filePath}`);
  } catch (err) {
    return errorResult(toErrorMessage(err));
  }
}

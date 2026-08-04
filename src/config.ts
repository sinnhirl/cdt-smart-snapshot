/**
 * Application configuration from environment variables.
 */

import {tmpdir} from 'node:os';
import {join} from 'node:path';

import type {AppConfig} from './types.js';

/**
 * Loads configuration from process.env with SPEC defaults.
 *
 * Why: Edge CDP may be on 9222 (local) or 9223 (portproxy); screenshots default
 * to a system temp subdirectory so agents never dump base64 into context.
 *
 * @param env - Environment map (defaults to process.env).
 * @returns Resolved AppConfig.
 * @throws Never throws; invalid numbers fall back to defaults.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const wsEndpoint = env.CDT_WS_ENDPOINT;
  const browserURL = env.CDT_BROWSER_URL ?? 'http://127.0.0.1:9222';
  const screenshotDir = env.CDT_SNAPSHOT_DIR ?? join(tmpdir(), 'cdt-snapshots');
  const parsedDepth = Number.parseInt(env.CDT_MAX_DEPTH ?? '8', 10);
  const defaultMaxDepth =
    Number.isFinite(parsedDepth) && parsedDepth >= 1 && parsedDepth <= 20
      ? parsedDepth
      : 8;

  return {
    wsEndpoint:
      wsEndpoint !== undefined && wsEndpoint.length > 0
        ? wsEndpoint
        : undefined,
    browserURL,
    screenshotDir,
    defaultMaxDepth,
  };
}

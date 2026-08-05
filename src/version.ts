/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Package version for MCP initialize metadata (kept in sync with package.json).
 */

import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Reads the semver from package.json adjacent to the build output.
 *
 * @returns Version string such as "0.1.2".
 * @throws Error when package.json is missing or malformed.
 */
export function readPackageVersion(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, '..', 'package.json'),
    join(moduleDir, '..', '..', 'package.json'),
  ];
  let packagePath: string | undefined;
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      packagePath = candidate;
      break;
    }
  }
  if (packagePath === undefined) {
    throw new Error('package.json not found');
  }
  const raw = readFileSync(packagePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid package.json');
  }
  if (!('version' in parsed)) {
    throw new Error('package.json missing version');
  }
  const version = parsed.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('package.json version must be a non-empty string');
  }
  return version;
}

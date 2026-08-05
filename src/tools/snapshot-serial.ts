/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Serializes snapshot tool handlers so global diff/uid state is not interleaved.
 *
 * Why: previousSnapshot and defaultUidMapper are process-wide; concurrent MCP
 * CallTool requests would corrupt diff baselines without a single-file queue.
 */

let tail: Promise<void> = Promise.resolve();

/**
 * Runs a snapshot-related tool handler exclusively (one at a time per process).
 *
 * @param fn - Async work for one tool invocation.
 * @returns The handler result.
 * @throws Rethrows errors from fn after releasing the queue slot.
 */
export function runExclusiveSnapshotTool<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(() => fn());
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

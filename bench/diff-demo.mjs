/**
 * snapshot_diff end-to-end demo on the live Gmail page.
 *
 * Run from project dir: node bench/diff-demo.mjs
 *
 * Simulates a multi-step agent session: call 1 returns the full tree,
 * then each subsequent call re-snapshots and returns only changes.
 * On a real page with no DOM mutation the diff is "(no changes)" — we
 * demonstrate the incremental mechanism with two synthetic mutations
 * (rename a label, add a node) to show added/changed output.
 */
import puppeteer from 'puppeteer-core';
import {fetchAxTreeWithVisibility} from '../build/src/browser.js';
import {normalizeAxTree} from '../build/src/core/ax-tree.js';
import {defaultUidMapper} from '../build/src/core/uid.js';
import {applyVisibility, filterHidden} from '../build/src/core/visibility.js';
import {filterByInteraction} from '../build/src/core/interaction.js';
import {dedupeTree} from '../build/src/core/dedupe.js';
import {pruneTree} from '../build/src/core/prune.js';
import {formatTree} from '../build/src/core/snapshot.js';
import {remapVisibilityToUid} from '../build/src/tools/helpers.js';
import {runSnapshotDiff, resetDiffHistory} from '../build/src/core/diff.js';

const BROWSER_URL = process.env.CDT_BROWSER_URL ?? 'http://172.27.64.1:9223';

async function snapshotPage(browser) {
  const pages = await browser.pages();
  const target =
    pages.find(p => p.url().includes('mail.google.com')) ?? pages.at(-1);
  const {raw, visibilityByBackendId} = await fetchAxTreeWithVisibility(target);
  const normalized = normalizeAxTree(raw, defaultUidMapper);
  const visByUid = remapVisibilityToUid(normalized, visibilityByBackendId);
  const withVis = applyVisibility(normalized, visByUid);
  const visibleOnly = filterHidden(withVis, false);
  const interactive = filterByInteraction(visibleOnly, false);
  const deduped = dedupeTree(interactive);
  const pruned = pruneTree(deduped, {maxDepth: 8});
  const text = formatTree(pruned);
  return {root: pruned, text};
}

const browser = await puppeteer.connect({
  browserURL: BROWSER_URL,
  defaultViewport: null, // inherit real viewport; avoids 800x600 mini-windows
});

resetDiffHistory();
console.error('[demo] === Step 1: initial snapshot (full) ===');
let snap = await snapshotPage(browser);
const step1 = runSnapshotDiff(snap.root, snap.text);
console.log(`[step1] ${step1.split('\n').length} lines (full tree, chars=${step1.length})`);

// Step 2: no mutation → expect "(no changes)"
console.error('[demo] === Step 2: no page change ===');
snap = await snapshotPage(browser);
const step2 = runSnapshotDiff(snap.root, snap.text);
console.log(`[step2] ${step2.split('\n').length} lines, chars=${step2.length}`);
console.log('[step2]', step2.slice(0, 80));

// Step 3: synthetic mutation — mutate the tree in memory (rename a node,
// add a node) to demonstrate added/changed output without touching the page.
console.error('[demo] === Step 3: synthetic changes ===');
const mutated = JSON.parse(JSON.stringify(snap.root));
const queue = [mutated];
let renamed = 0;
let added = 0;
while (queue.length > 0 && (renamed < 1 || added < 1)) {
  const node = queue.shift();
  if (renamed < 1 && node.role === 'link' && node.name.includes('Inbox')) {
    node.name = 'Inbox (99 unread)'; // simulate unread count change
    renamed += 1;
  }
  if (added < 1 && node.role === 'main') {
    node.children.push({
      uid: 99999,
      role: 'button',
      name: 'New notification badge',
      children: [],
      visible: true,
    });
    added += 1;
  }
  for (const c of node.children ?? []) queue.push(c);
}
const step3 = runSnapshotDiff(mutated, snap.text);
console.log(`[step3] ${step3.split('\n').length} lines, chars=${step3.length}`);
console.log(step3);

await browser.disconnect();

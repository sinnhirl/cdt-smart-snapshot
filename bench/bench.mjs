/**
 * End-to-end benchmark: connects to the live Edge (via portproxy 9223),
 * runs the smart snapshot pipeline on the active Gmail page, and reports
 * node counts vs. the official full AX tree.
 *
 * Run from project dir: node bench/bench.mjs
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

const BROWSER_URL = process.env.CDT_BROWSER_URL ?? 'http://172.27.64.1:9223';

function countNodes(node) {
  if (node === null || node === undefined) return 0;
  let n = 1;
  for (const c of node.children ?? []) n += countNodes(c);
  return n;
}

const browser = await puppeteer.connect({browserURL: BROWSER_URL});
const pages = await browser.pages();
const target =
  pages.find(p => p.url().includes('mail.google.com')) ?? pages.at(-1);
console.error(`[bench] target: ${target?.url().slice(0, 70)}`);

// 1) Full AX tree + visibility in one pass.
const {raw, visibilityByBackendId} = await fetchAxTreeWithVisibility(target);
console.error(`[bench] full AX tree nodes: ${countNodes(raw)}`);

// 2) Normalize (assigns uids, keeps backendNodeId).
const normalized = normalizeAxTree(raw, defaultUidMapper);

// 3) Remap visibility backendNodeId → uid, then apply + filter hidden.
const visByUid = remapVisibilityToUid(normalized, visibilityByBackendId);
const withVis = applyVisibility(normalized, visByUid);
const visibleOnly = filterHidden(withVis, false);

// 4) Interaction filter (verbose=false).
const interactive = filterByInteraction(visibleOnly, false);

// 5) Dedupe + prune.
const deduped = dedupeTree(interactive);
const pruned = pruneTree(deduped, {maxDepth: 8});

// 6) Format.
const text = formatTree(pruned);
console.log(text);
console.error(`[bench] smart snapshot nodes: ${countNodes(pruned)}`);
console.error(`[bench] formatted chars: ${text.length}`);

await browser.disconnect();

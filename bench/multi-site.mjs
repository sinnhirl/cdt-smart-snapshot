/**
 * Multi-site benchmark: official take_snapshot (full AX tree, official format)
 * vs. smart_snapshot pipeline, across diverse real pages.
 *
 * Run from project dir: node bench/multi-site.mjs
 *
 * Opens a NEW tab per site, measures, then closes it — never navigates the
 * user's existing tabs (MCP multi-tab rule).
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

const SITES = [
  {name: 'Gmail (logged-in)', url: 'https://mail.google.com/', reuse: true},
  {name: 'Wikipedia (long doc)', url: 'https://en.wikipedia.org/wiki/Artificial_intelligence', reuse: false},
  {name: 'BBC News (portal)', url: 'https://www.bbc.com/news', reuse: false},
  {name: 'Amazon (e-commerce)', url: 'https://www.amazon.com/', reuse: false},
  {name: 'Bilibili (video)', url: 'https://www.bilibili.com/', reuse: false},
  {name: 'JD.com (CN e-commerce)', url: 'https://www.jd.com/', reuse: false},
  {name: 'GitHub (dev platform)', url: 'https://github.com/', reuse: false},
  {name: '163.com (CN portal)', url: 'https://www.163.com/', reuse: false},
];

const WAIT_MS = 4000; // settle time after load
const NAV_TIMEOUT = 20000;

function countNodes(node) {
  if (node === null || node === undefined) {return 0;}
  let n = 1;
  for (const c of node.children ?? []) {n += countNodes(c);}
  return n;
}

/**
 * Replicates official take_snapshot output format (SnapshotFormatter):
 * `uid=N role "name" extra-attr...` with 2-space indent per depth.
 * Uses the same puppeteer AX snapshot the official server uses.
 */
function officialFormat(node, depth = 0) {
  if (node === null || node === undefined) {return '';}
  const indent = '  '.repeat(depth);
  const attrs = [];
  if (node.id !== undefined) {attrs.push(`uid=${node.id}`);}
  if (node.role) {attrs.push(node.role === 'none' ? 'ignored' : node.role);}
  if (node.name) {attrs.push(`"${node.name}"`);}
  if (node.value !== undefined && node.value !== '') {attrs.push(`value="${node.value}"`);}
  let out = `${indent}${attrs.join(' ')}\n`;
  for (const c of node.children ?? []) {out += officialFormat(c, depth + 1);}
  return out;
}

async function measurePage(browser, site) {
  let page = null;
  try {
    if (site.reuse) {
      const pages = await browser.pages();
      page = pages.find(p => p.url().includes('mail.google.com')) ?? pages.at(-1);
    } else {
      page = await browser.newPage();
      await page.goto(site.url, {waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT}).catch(() => {});
      await new Promise(r => setTimeout(r, WAIT_MS));
    }

    // Official: full AX snapshot (interestingOnly like official take_snapshot) + official format.
    const axSnapshot = await page.accessibility.snapshot({
      interestingOnly: true,
      includeIframes: true,
    });
    const officialText = officialFormat(axSnapshot);
    const officialNodes = countNodes(axSnapshot);

    // Ours: full pipeline.
    const {raw, visibilityByBackendId} = await fetchAxTreeWithVisibility(page);
    const normalized = normalizeAxTree(raw, defaultUidMapper);
    const visByUid = remapVisibilityToUid(normalized, visibilityByBackendId);
    const withVis = applyVisibility(normalized, visByUid);
    const visibleOnly = filterHidden(withVis, false);
    const interactive = filterByInteraction(visibleOnly, false);
    const deduped = dedupeTree(interactive);
    const pruned = pruneTree(deduped, {maxDepth: 8});
    const smartText = formatTree(pruned);
    const smartNodes = countNodes(pruned);

    return {
      site: site.name,
      url: site.url,
      officialChars: officialText.length,
      officialNodes,
      officialTokens: Math.round(officialText.length / 4),
      smartChars: smartText.length,
      smartNodes,
      smartTokens: Math.round(smartText.length / 4),
      reduction: officialText.length > 0
        ? ((1 - smartText.length / officialText.length) * 100).toFixed(1)
        : '0',
    };
  } catch (err) {
    return {
      site: site.name,
      url: site.url,
      error: err instanceof Error ? err.message.slice(0, 80) : String(err),
    };
  } finally {
    if (page !== null && !site.reuse) {
      await page.close().catch(() => {});
    }
  }
}

const browser = await puppeteer.connect({
  browserURL: BROWSER_URL,
  defaultViewport: null, // inherit the real browser viewport — do NOT force 800x600
});
console.log('Running multi-site benchmark…\n');
const results = [];
for (const site of SITES) {
  const r = await measurePage(browser, site);
  results.push(r);
  if (r.error) {
    console.log(`[${r.site}] ERROR: ${r.error}`);
  } else {
    console.log(
      `[${r.site}] official ${r.officialNodes} nodes / ${r.officialChars} chars` +
      ` → smart ${r.smartNodes} nodes / ${r.smartChars} chars` +
      ` (${r.reduction}% reduction)`,
    );
  }
}
await browser.disconnect();

console.log('\n=== SUMMARY TABLE ===');
console.log('| Site | Official nodes | Official chars | Smart nodes | Smart chars | Reduction |');
console.log('|------|---------------|----------------|-------------|-------------|-----------|');
for (const r of results) {
  if (r.error) {
    console.log(`| ${r.site} | — | — | — | — | ERROR: ${r.error} |`);
  } else {
    console.log(
      `| ${r.site} | ${r.officialNodes} | ${r.officialChars} | ${r.smartNodes} | ${r.smartChars} | ${r.reduction}% |`,
    );
  }
}

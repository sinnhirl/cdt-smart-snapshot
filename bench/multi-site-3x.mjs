/**
 * 3-round multi-site benchmark: official take_snapshot (full AX tree, official
 * format) vs. smart_snapshot pipeline, across 15 diverse real pages, 3 rounds
 * each, to verify stability.
 *
 * Run from project dir: node bench/multi-site-3x.mjs
 *
 * Opens a NEW tab per site per round, measures, then closes it — never
 * navigates the user's existing tabs (MCP multi-tab rule).
 */
import puppeteer from 'puppeteer-core';
import {writeFileSync} from 'node:fs';
import {fetchAxTreeWithVisibility} from '../build/src/browser.js';
import {normalizeAxTree} from '../build/src/core/ax-tree.js';
import {defaultUidMapper} from '../build/src/core/uid.js';
import {applyVisibility, filterHidden} from '../build/src/core/visibility.js';
import {filterByInteraction} from '../build/src/core/interaction.js';
import {
  dedupeTree,
  collapseSameNameChildren,
} from '../build/src/core/dedupe.js';
import {pruneTree} from '../build/src/core/prune.js';
import {formatTree} from '../build/src/core/snapshot.js';
import {remapVisibilityToUid} from '../build/src/tools/helpers.js';

const BROWSER_URL = process.env.CDT_BROWSER_URL ?? 'http://172.27.64.1:9223';
const ROUNDS = 3;

const SITES = [
  {name: 'Gmail (logged-in)', url: 'https://mail.google.com/'},
  {
    name: 'Wikipedia (long doc)',
    url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
  },
  {name: 'BBC News (portal)', url: 'https://www.bbc.com/news'},
  {name: 'Amazon (e-commerce)', url: 'https://www.amazon.com/'},
  {name: 'Bilibili (video)', url: 'https://www.bilibili.com/'},
  {name: 'JD.com (CN e-commerce)', url: 'https://www.jd.com/'},
  {name: 'GitHub (dev platform)', url: 'https://github.com/'},
  {name: '163.com (CN portal)', url: 'https://www.163.com/'},
  {name: 'Google (search)', url: 'https://www.google.com/'},
  {name: 'YouTube (video)', url: 'https://www.youtube.com/'},
  {name: 'Reddit (social)', url: 'https://www.reddit.com/'},
  {name: 'Baidu (CN search)', url: 'https://www.baidu.com/'},
  {name: 'Zhihu (CN Q&A)', url: 'https://www.zhihu.com/'},
  {name: 'CNN (news)', url: 'https://www.cnn.com/'},
  {name: 'Stack Overflow (Q&A)', url: 'https://stackoverflow.com/'},
];

const NAV_TIMEOUT = 25000;
const SETTLE_MS = 1000; // 1s is enough for the AX tree to settle after network idle
const MIN_NODES_OK = 30; // below this, page likely didn't finish loading → retry

function countNodes(node) {
  if (node === null || node === undefined) {
    return 0;
  }
  let n = 1;
  for (const c of node.children ?? []) {
    n += countNodes(c);
  }
  return n;
}

/**
 * Replicates official take_snapshot output format (SnapshotFormatter):
 * `uid=N role "name" value="..."` with 2-space indent per depth.
 */
function officialFormat(node, depth = 0) {
  if (node === null || node === undefined) {
    return '';
  }
  const indent = '  '.repeat(depth);
  const attrs = [];
  if (node.id !== undefined) {
    attrs.push(`uid=${node.id}`);
  }
  if (node.role) {
    attrs.push(node.role === 'none' ? 'ignored' : node.role);
  }
  if (node.name) {
    attrs.push(`"${node.name}"`);
  }
  if (node.value !== undefined && node.value !== '') {
    attrs.push(`value="${node.value}"`);
  }
  let out = `${indent}${attrs.join(' ')}\n`;
  for (const c of node.children ?? []) {
    out += officialFormat(c, depth + 1);
  }
  return out;
}

async function loadPage(page, url) {
  // Try up to 2 times: networkidle2 + settle; fall back to a longer wait.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page
        .goto(url, {waitUntil: 'networkidle2', timeout: NAV_TIMEOUT})
        .catch(() => {});
    } catch {
      /* ignore nav errors — page may still partially render */
    }
    await new Promise(r => setTimeout(r, SETTLE_MS));
    const snap = await page.accessibility
      .snapshot({
        interestingOnly: true,
        includeIframes: true,
      })
      .catch(() => null);
    if (snap !== null && countNodes(snap) >= MIN_NODES_OK) {
      return {snap, ok: true};
    }
    // Retry: force reload.
    try {
      await page
        .reload({waitUntil: 'networkidle2', timeout: NAV_TIMEOUT})
        .catch(() => {});
    } catch {}
    await new Promise(r => setTimeout(r, SETTLE_MS));
  }
  const snap = await page.accessibility
    .snapshot({
      interestingOnly: true,
      includeIframes: true,
    })
    .catch(() => null);
  return {snap, ok: snap !== null && countNodes(snap) >= MIN_NODES_OK};
}

async function measurePage(browser, site) {
  const page = await browser.newPage();
  try {
    const {snap, ok} = await loadPage(page, site.url);
    if (!ok) {
      return {
        site: site.name,
        url: site.url,
        error: 'page did not finish loading (anti-bot / lazy-load)',
      };
    }
    const officialText = officialFormat(snap);
    const officialNodes = countNodes(snap);

    const {raw, visibilityByBackendId} = await fetchAxTreeWithVisibility(page);
    const normalized = normalizeAxTree(raw, defaultUidMapper);
    const visByUid = remapVisibilityToUid(normalized, visibilityByBackendId);
    const withVis = applyVisibility(normalized, visByUid);
    const visibleOnly = filterHidden(withVis, false);
    const interactive = filterByInteraction(visibleOnly, false);
    const deduped = dedupeTree(interactive);
    const collapsed = collapseSameNameChildren(deduped);
    const pruned = pruneTree(collapsed, {maxDepth: 8});
    const smartText = formatTree(pruned);
    const smartNodes = countNodes(pruned);

    const reduction =
      officialText.length > 0
        ? (1 - smartText.length / officialText.length) * 100
        : 0;

    return {
      site: site.name,
      url: site.url,
      officialChars: officialText.length,
      officialNodes,
      officialTokens: Math.round(officialText.length / 4),
      smartChars: smartText.length,
      smartNodes,
      smartTokens: Math.round(smartText.length / 4),
      reduction,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

const browser = await puppeteer.connect({
  browserURL: BROWSER_URL,
  defaultViewport: null, // inherit real viewport — do NOT force 800x600
});

// roundResults[round][siteName] = result
const roundResults = [];
for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n========== ROUND ${round}/${ROUNDS} ==========`);
  const results = {};
  for (const site of SITES) {
    const r = await measurePage(browser, site);
    results[site.name] = r;
    if (r.error) {
      console.log(`  [${r.site}] ERROR: ${r.error}`);
    } else {
      console.log(
        `  [${r.site}] official ${r.officialNodes}n/${r.officialChars}c → smart ${r.smartNodes}n/${r.smartChars}c (${r.reduction.toFixed(1)}%)`,
      );
    }
  }
  roundResults.push(results);
  // Persist after every round so a timeout/crash never loses all data.
  writeFileSync(
    new URL('./bench-results-3x.json', import.meta.url),
    JSON.stringify(
      {runAt: new Date().toISOString(), rounds: ROUNDS, roundResults},
      null,
      2,
    ),
    'utf8',
  );
}
await browser.disconnect();

// ---------- Summary: per-site 3-round stats ----------
console.log('\n\n========== 3-ROUND SUMMARY (stability) ==========');
console.log(
  '| Site | R1 red% | R2 red% | R3 red% | avg red% | Δ(max-min) | official chars avg | smart chars avg |',
);
console.log(
  '|------|---------|---------|---------|----------|------------|--------------------|-----------------|',
);
for (const site of SITES) {
  const rs = roundResults.map(rr => rr[site.name]);
  const valid = rs.filter(r => !r.error);
  if (valid.length === 0) {
    console.log(`| ${site.name} | — | — | — | — | — | ERROR all rounds |`);
    continue;
  }
  const reds = valid.map(r => r.reduction);
  const avgRed = reds.reduce((a, b) => a + b, 0) / reds.length;
  const spread = Math.max(...reds) - Math.min(...reds);
  const avgOfficial = Math.round(
    valid.reduce((a, r) => a + r.officialChars, 0) / valid.length,
  );
  const avgSmart = Math.round(
    valid.reduce((a, r) => a + r.smartChars, 0) / valid.length,
  );
  const redStr = i => (rs[i]?.error ? '—' : `${rs[i].reduction.toFixed(1)}%`);
  console.log(
    `| ${site.name} | ${redStr(0)} | ${redStr(1)} | ${redStr(2)} | ${avgRed.toFixed(1)}% | ${spread.toFixed(1)}pp | ${avgOfficial} | ${avgSmart} |`,
  );
}

// Overall averages (valid sites only)
console.log('\n--- Overall (valid sites, all rounds) ---');
const allValid = roundResults
  .flatMap(rr => Object.values(rr))
  .filter(r => !r.error);
const overallRed =
  allValid.reduce((a, r) => a + r.reduction, 0) / allValid.length;
const overallOfficial =
  allValid.reduce((a, r) => a + r.officialChars, 0) / allValid.length;
const overallSmart =
  allValid.reduce((a, r) => a + r.smartChars, 0) / allValid.length;
console.log(`valid measurements: ${allValid.length}/${ROUNDS * SITES.length}`);
console.log(`avg reduction: ${overallRed.toFixed(1)}%`);
console.log(
  `avg official chars: ${Math.round(overallOfficial)} → avg smart chars: ${Math.round(overallSmart)}`,
);
console.log(
  `avg official tokens (~/4): ${Math.round(overallOfficial / 4)} → avg smart tokens: ${Math.round(overallSmart / 4)}`,
);

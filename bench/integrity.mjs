/**
 * Content-integrity regression: after the bugfix batch (C1/C2 + 8 fixes),
 * verify smart_snapshot still captures the anchors agents need to operate.
 *
 * For each site we assert that specific interactive/text anchors that were
 * present pre-fix are STILL present post-fix. This catches over-aggressive
 * filtering (V1 large-page AX-only drops, D2 non-merge, N1 collapse guards).
 *
 * Run: CDT_BROWSER_URL=http://172.27.64.1:9223 node bench/integrity.mjs
 */
import puppeteer from 'puppeteer-core';

import {
  fetchAxTreeWithVisibility,
  getActivePage,
} from '../build/src/browser.js';
import {normalizeAxTree} from '../build/src/core/ax-tree.js';
import {defaultUidMapper} from '../build/src/core/uid.js';
import {remapVisibilityToUid} from '../build/src/tools/helpers.js';
import {runSmartSnapshotPipeline} from '../build/src/core/snapshot.js';

const BROWSER_URL = process.env.CDT_BROWSER_URL ?? 'http://127.0.0.1:9222';

/**
 * Sites to check. `anchor` is a substring that MUST appear in the smart
 * snapshot text for the agent to be able to operate on that page.
 */
const SITES = [
  {
    name: 'GitHub (repo page)',
    url: 'https://github.com/sinnhirl/cdt-smart-snapshot',
    anchors: ['Code', 'Issues', 'smart_snapshot', 'snapshot_diff'],
    reason: 'repo nav + tool names must survive',
  },
  {
    name: 'Wikipedia AI',
    url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
    anchors: ['Artificial intelligence', 'History', 'Applications'],
    reason: 'long-doc page — V1 AX-only drop risk',
  },
  {
    name: 'DeepSeek console',
    url: 'https://platform.deepseek.com/usage',
    anchors: ['API keys', '用量信息', '充值', '账单', '导出', '去充值'],
    reason: 'logged-in app nav + buttons must survive',
  },
  {
    name: 'Movie street (demo SPA)',
    url: 'https://movie-street.vercel.app/',
    anchors: ['电影', '影宙'],
    reason: 'Chinese SPA text must survive',
  },
];

function collectText(node, depth, out) {
  out.push(`${'  '.repeat(depth)}[${node.role}] ${node.name ?? ''}`.trim());
  for (const c of node.children ?? []) {
    collectText(c, depth + 1, out);
  }
}

async function checkOne(page, site) {
  // Open in a NEW tab; never navigate the user's own tabs.
  const tab = await page.browser().newPage();
  try {
    await tab.goto(site.url, {waitUntil: 'networkidle2', timeout: 45000});
    // Extra settle for lazy-rendered SPAs.
    await new Promise(r => setTimeout(r, 4000));

    const {raw, visibilityByBackendId, visibilitySkipped} =
      await fetchAxTreeWithVisibility(tab);
    const normalized = normalizeAxTree(raw, defaultUidMapper);
    const visByUid = remapVisibilityToUid(normalized, visibilityByBackendId);
    const result = runSmartSnapshotPipeline(
      normalized,
      {maxDepth: 8, includeHidden: false, verbose: false},
      visByUid.size > 0 ? visByUid : undefined,
      visibilitySkipped,
    );
    const text = result.formatted;

    const lines = [];
    collectText(result.root, 0, lines);
    const found = [];
    const missing = [];
    for (const a of site.anchors) {
      const hit = text.includes(a) || lines.some(l => l.includes(a));
      (hit ? found : missing).push(a);
    }

    console.log(`\n=== ${site.name} ===`);
    console.log(
      `  smart chars: ${text.length} | nodes: ${lines.length} | visSkipped: ${visibilitySkipped}`,
    );
    console.log(`  ✓ found: ${found.join(', ')}`);
    if (missing.length > 0) {
      console.log(`  ✗ MISSING: ${missing.join(', ')}`);
    }
    if (lines.length > 0) {
      console.log(`  sample: ${lines.slice(0, 3).join(' | ')}`);
    }
    return {site: site.name, found, missing, chars: text.length, skipped: visibilitySkipped};
  } finally {
    await tab.close();
  }
}

async function main() {
  const browser = await puppeteer.connect({
    browserURL: BROWSER_URL,
    defaultViewport: null,
  });
  const page = await browser.newPage();
  await page.goto('about:blank');
  try {
    const results = [];
    for (const site of SITES) {
      try {
        results.push(await checkOne(page, site));
      } catch (err) {
        console.log(`\n=== ${site.name} === ERROR: ${String(err).slice(0, 120)}`);
        results.push({site: site.name, found: [], missing: site.anchors, error: true});
      }
    }
    console.log('\n\n========== SUMMARY ==========');
    let fail = 0;
    for (const r of results) {
      const ok = r.missing.length === 0;
      if (!ok) fail += 1;
      console.log(`  ${ok ? '✅' : '❌'} ${r.site}: ${r.missing.length === 0 ? 'all anchors present' : `MISSING ${r.missing.join(', ')}`}`);
    }
    console.log(`\n${results.length - fail}/${results.length} sites fully intact`);
  } finally {
    await page.close();
    await browser.disconnect();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});

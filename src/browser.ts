/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Puppeteer-core browser connection management.
 * THIS IS THE ONLY MODULE THAT IMPORTS puppeteer-core.
 *
 * Why: Isolating browser I/O here keeps src/core/ pure and unit-testable, and
 * lets tools.test.ts mock this module without launching Chrome.
 */

import puppeteer from 'puppeteer-core';
import type {Browser, CDPSession, Page, SerializedAXNode} from 'puppeteer-core';

import {loadConfig} from './config.js';
import type {ElementVisibilityInfo, RawAxNode} from './types.js';

let browserInstance: Browser | undefined;
let connectError: string | undefined;
let pendingConnect: Promise<Browser> | undefined;

/**
 * Clears the singleton after the browser disconnects.
 *
 * @returns void
 * @throws Never throws.
 */
function clearBrowserInstance(): void {
  browserInstance = undefined;
  pendingConnect = undefined;
}

/**
 * Attaches a one-time disconnected handler so stale singletons are dropped.
 *
 * @param browser - Connected browser.
 * @returns void
 * @throws Never throws.
 */
function watchBrowserDisconnect(browser: Browser): void {
  browser.on('disconnected', () => {
    clearBrowserInstance();
  });
}

/**
 * Above this AX-node count, per-node visibility collection (one CDP
 * round-trip per node) would be too slow — skip precise visibility and rely
 * on role filtering + dedupe + depth prune instead.
 */
const VISIBILITY_MAX_NODES = 2000;

/**
 * Describes a connected page plus helpers used by tools.
 */
export interface ActivePage {
  page: Page;
  /** Target URL for error messages. */
  url: string;
}

/**
 * Extracts a readable message from an unknown thrown value.
 *
 * @param err - Unknown catch value.
 * @returns Message string.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Opens a puppeteer connection via wsEndpoint or browserURL.
 *
 * @param wsEndpoint - Optional WebSocket endpoint.
 * @param browserURL - HTTP CDP URL.
 * @returns Connected Browser.
 */
async function openConnection(
  wsEndpoint: string | undefined,
  browserURL: string,
): Promise<Browser> {
  if (wsEndpoint !== undefined) {
    return puppeteer.connect({browserWSEndpoint: wsEndpoint});
  }
  return puppeteer.connect({browserURL});
}

/**
 * Opens a new browser connection with one automatic retry on failure.
 *
 * @returns Connected Browser singleton instance.
 * @throws Error when both connection attempts fail.
 */
async function establishConnection(): Promise<Browser> {
  const config = loadConfig();
  try {
    const browser = await openConnection(config.wsEndpoint, config.browserURL);
    connectError = undefined;
    watchBrowserDisconnect(browser);
    browserInstance = browser;
    return browser;
  } catch (firstErr) {
    try {
      const browser = await openConnection(
        config.wsEndpoint,
        config.browserURL,
      );
      connectError = undefined;
      watchBrowserDisconnect(browser);
      browserInstance = browser;
      return browser;
    } catch (secondErr) {
      const msg = errorMessage(secondErr);
      const firstMsg = errorMessage(firstErr);
      const endpoint = config.wsEndpoint ?? config.browserURL;
      connectError = `Failed to connect to browser at ${endpoint}: ${msg} (first attempt: ${firstMsg})`;
      throw new Error(connectError, {cause: firstErr});
    }
  }
}

/**
 * Connects to the browser (singleton), reconnecting once on failure.
 *
 * @returns Connected Browser.
 * @throws Error when connection fails after retry.
 */
export async function connectBrowser(): Promise<Browser> {
  if (browserInstance !== undefined && browserInstance.connected) {
    return browserInstance;
  }

  if (browserInstance !== undefined && !browserInstance.connected) {
    try {
      await browserInstance.disconnect();
    } catch {
      // Stale handle may already be torn down.
    }
    clearBrowserInstance();
  }

  if (pendingConnect !== undefined) {
    return pendingConnect;
  }

  pendingConnect = establishConnection().finally(() => {
    pendingConnect = undefined;
  });
  return pendingConnect;
}

/**
 * Returns the last connect error message, if any.
 *
 * @returns Error string or undefined.
 * @throws Never throws.
 */
export function getLastConnectError(): string | undefined {
  return connectError;
}

/**
 * Disconnects and clears the singleton (tests / shutdown).
 *
 * @returns Resolves when disconnect completes.
 * @throws Never throws.
 */
export async function disconnectBrowser(): Promise<void> {
  if (browserInstance !== undefined) {
    try {
      await browserInstance.disconnect();
    } catch {
      // ignore disconnect errors during cleanup
    }
    clearBrowserInstance();
  }
  pendingConnect = undefined;
  resetDiagnosticsAttachmentState();
}

/**
 * Selects the active page: last non-blank, non-devtools page in browser.pages().
 *
 * Why: Agent workflows typically operate on the foremost tab; pages.at(-1) matches
 * chrome-devtools-mcp conventions for "current" page.
 *
 * @returns Active page wrapper.
 * @throws Error when no suitable page exists or browser is unreachable.
 */
export async function getActivePage(): Promise<ActivePage> {
  const browser = await connectBrowser();
  const pages = await browser.pages();
  const candidates: Page[] = [];
  for (const page of pages) {
    const url = page.url();
    if (url === 'about:blank') {
      continue;
    }
    if (url.startsWith('devtools://')) {
      continue;
    }
    candidates.push(page);
  }

  if (candidates.length === 0) {
    throw new Error(
      'No active page available (all pages are blank or DevTools)',
    );
  }

  const page = candidates[candidates.length - 1];
  if (page === undefined) {
    throw new Error(
      'No active page available (all pages are blank or DevTools)',
    );
  }
  attachPageDiagnostics(page);
  return {page, url: page.url()};
}

/**
 * Converts a puppeteer SerializedAXNode into our RawAxNode (no type assertions).
 *
 * @param node - Puppeteer AX node.
 * @returns RawAxNode for core/ax-tree normalization.
 */
function snapshotToRaw(node: SerializedAXNode): RawAxNode {
  const raw: RawAxNode = {
    role: node.role,
    name: node.name,
  };
  if (node.value !== undefined) {
    raw.value = node.value;
  }
  // Puppeteer's SerializedAXNode type omits backendNodeId although Chromium
  // includes it at runtime. Narrow via `in` + typeof instead of a type
  // assertion (assertions are banned by AGENTS.md).
  if ('backendNodeId' in node && typeof node.backendNodeId === 'number') {
    raw.backendDOMNodeId = node.backendNodeId;
  }
  if (node.children !== undefined) {
    const children: RawAxNode[] = [];
    for (const child of node.children) {
      children.push(snapshotToRaw(child));
    }
    raw.children = children;
  }
  return raw;
}

/**
 * Fetches the accessibility tree for the active page.
 *
 * @param page - Puppeteer page.
 * @returns Raw AX root node (or null).
 * @throws When the accessibility snapshot call fails.
 */
export async function fetchAxTree(page: Page): Promise<RawAxNode | null> {
  const snapshot = await page.accessibility.snapshot({
    interestingOnly: true,
    includeIframes: true,
  });
  if (snapshot === null) {
    return null;
  }
  return snapshotToRaw(snapshot);
}

/**
 * Geometry payload returned from page.evaluate for one element.
 */
interface EvaluatedGeometry {
  display: string;
  visibility: string;
  opacity: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Minimal structural shape walkAxForVisibility needs from an AX node.
 *
 * Why: puppeteer's SerializedAXNode exposes elementHandle(): Promise<ElementHandle>
 * whose full type has private fields — impossible to mock in tests without banned
 * `as` assertions. Defining the structural slice we actually call keeps the walk
 * testable and lets a real SerializedAXNode satisfy it structurally.
 */
export interface VisibilityAxNode {
  backendNodeId?: number;
  children?: VisibilityAxNode[];
  elementHandle(): Promise<{
    evaluate<T>(fn: (el: Element) => T): Promise<T>;
    dispose(): Promise<void>;
  } | null>;
}

/**
 * Collects visibility info for every AX node that has a backendNodeId.
 *
 * Why: Batching via elementHandle().evaluate keeps core pure while still using
 * real getBoundingClientRect / computed style from the live page.
 *
 * @param axRoot - Puppeteer AX snapshot root.
 * @returns Map keyed by backendNodeId.
 * @throws Never throws for individual node failures; skips nodes that error.
 */
export async function collectVisibilityByBackendId(
  axRoot: VisibilityAxNode,
): Promise<Map<number, ElementVisibilityInfo>> {
  const map = new Map<number, ElementVisibilityInfo>();
  await walkAxForVisibility(axRoot, map);
  return map;
}

/**
 * Recursive walk that fills the visibility map.
 *
 * @param node - Current AX node.
 * @param map - Accumulator keyed by backendNodeId.
 */
async function walkAxForVisibility(
  node: VisibilityAxNode,
  map: Map<number, ElementVisibilityInfo>,
): Promise<void> {
  // backendNodeId is not part of the public SerializedAXNode type; narrow it
  // safely with `in` + typeof (no banned assertions).
  if ('backendNodeId' in node && typeof node.backendNodeId === 'number') {
    try {
      const handle = await node.elementHandle();
      if (handle !== null) {
        try {
          const geo: EvaluatedGeometry = await handle.evaluate(el => {
            // RootWebArea's elementHandle resolves to the HTMLDocument
            // (nodeType 9). getComputedStyle/getBoundingClientRect throw on
            // documents, and documentElement reports a zero-height rect in
            // CDP pages. The root is the page container — it is by definition
            // visible (there is no 'hidden document'), so return a visible
            // full-viewport geometry instead of measuring.
            if (el instanceof Document) {
              return {
                display: 'block',
                visibility: 'visible',
                opacity: 1,
                top: 0,
                left: 0,
                bottom: window.innerHeight,
                right: window.innerWidth,
                width: window.innerWidth,
                height: window.innerHeight,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
              };
            }
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
              display: style.display,
              visibility: style.visibility,
              opacity: Number(style.opacity),
              top: rect.top,
              left: rect.left,
              bottom: rect.bottom,
              right: rect.right,
              width: rect.width,
              height: rect.height,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
            };
          });
          map.set(node.backendNodeId, {
            display: geo.display,
            visibility: geo.visibility,
            opacity: geo.opacity,
            rect: {
              top: geo.top,
              left: geo.left,
              bottom: geo.bottom,
              right: geo.right,
              width: geo.width,
              height: geo.height,
            },
            viewportWidth: geo.viewportWidth,
            viewportHeight: geo.viewportHeight,
          });
        } catch {
          // Skip nodes whose handles are stale; treat as unknown visibility.
        } finally {
          await handle.dispose();
        }
      }
    } catch {
      // elementHandle() failed; treat as unknown visibility.
    }
  }
  if (node.children !== undefined) {
    for (const child of node.children) {
      await walkAxForVisibility(child, map);
    }
  }
}

/**
 * Counts nodes in a raw AX tree (for the visibility fast-path threshold).
 *
 * @param node - Raw AX node.
 * @returns Total node count.
 */
function countAxNodes(node: SerializedAXNode | null): number {
  if (node === null || node === undefined) {
    return 0;
  }
  let n = 1;
  for (const child of node.children ?? []) {
    n += countAxNodes(child);
  }
  return n;
}

/**
 * Fetches AX tree and visibility info in one pass (reuses the same snapshot).
 *
 * Why: per-node elementHandle().evaluate visibility collection costs one CDP
 * round-trip per node. On huge pages (Wikipedia ~17k nodes) that is 17k
 * sequential round-trips — effectively a hang. Above VISIBILITY_MAX_NODES we
 * skip precise visibility and rely on role filtering + dedupe + depth prune
 * (pure, millisecond-fast) so large pages stay responsive.
 *
 * @param page - Puppeteer page.
 * @returns Raw tree plus visibility keyed by backendNodeId.
 * @throws When accessibility snapshot fails.
 */
export async function fetchAxTreeWithVisibility(page: Page): Promise<{
  raw: RawAxNode | null;
  visibilityByBackendId: Map<number, ElementVisibilityInfo>;
  /** True when per-node visibility collection was skipped (page too large). */
  visibilitySkipped: boolean;
}> {
  const snapshot = await page.accessibility.snapshot({
    interestingOnly: true,
    includeIframes: true,
  });
  if (snapshot === null) {
    return {
      raw: null,
      visibilityByBackendId: new Map(),
      visibilitySkipped: false,
    };
  }
  const nodeCount = countAxNodes(snapshot);
  const skipped = nodeCount > VISIBILITY_MAX_NODES;
  const visibilityByBackendId = skipped
    ? new Map<number, ElementVisibilityInfo>()
    : await collectVisibilityByBackendId(snapshot);
  return {
    raw: snapshotToRaw(snapshot),
    visibilityByBackendId,
    visibilitySkipped: skipped,
  };
}

/**
 * Takes a screenshot and writes it to disk.
 *
 * @param page - Puppeteer page.
 * @param filePath - Absolute path including filename.
 * @param format - png or jpeg.
 * @param quality - JPEG quality 0-100 (ignored for png).
 * @param fullPage - Capture full scrollable page when true.
 * @returns The filePath written.
 * @throws When screenshot or filesystem write fails.
 */
export async function takeScreenshotToPath(
  page: Page,
  filePath: string,
  format: 'png' | 'jpeg',
  quality: number,
  fullPage: boolean,
): Promise<string> {
  if (format === 'jpeg') {
    await page.screenshot({
      path: filePath,
      type: 'jpeg',
      quality,
      fullPage,
    });
  } else {
    await page.screenshot({
      path: filePath,
      type: 'png',
      fullPage,
    });
  }
  return filePath;
}

/**
 * Live DOM facts for one backend node (filled via CDP resolve + callFunctionOn).
 */
export interface DomNodeState {
  tagName: string;
  cssSelector: string;
  value?: string;
  checked?: boolean;
  placeholder?: string;
  disabled?: boolean;
  textContent?: string;
  rect?: {top: number; left: number; width: number; height: number};
  visible: boolean;
}

/**
 * One buffered console / pageerror / failed-request line.
 */
export interface DiagnosticEntry {
  message: string;
  level: 'error' | 'warn' | 'log' | 'pageerror' | 'request';
  timestampMs: number;
  url?: string;
}

/**
 * Aggregated diagnostics returned to page_status.
 */
export interface PageDiagnostics {
  consoleErrors: DiagnosticEntry[];
  pageExceptions: DiagnosticEntry[];
  failedRequests: DiagnosticEntry[];
}

const DIAGNOSTICS_CAP = 20;
// WeakSet so closed pages can be GC'd (R4-2: a Set would pin every page
// object + its buffers for the server's lifetime).
const diagnosticsAttached = new WeakSet<Page>();
const diagnosticsByPage = new WeakMap<
  Page,
  {
    console: DiagnosticEntry[];
    pageExceptions: DiagnosticEntry[];
    failedRequests: DiagnosticEntry[];
  }
>();

/**
 * Reads objectId from a DOM.resolveNode CDP payload.
 *
 * @param value - CDP response body.
 * @returns objectId or undefined.
 */
function readResolveObjectId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  if (!('object' in value)) {
    return undefined;
  }
  const obj = value.object;
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }
  if (!('objectId' in obj)) {
    return undefined;
  }
  const objectId = obj.objectId;
  if (typeof objectId === 'string') {
    return objectId;
  }
  return undefined;
}

/**
 * Reads a callFunctionOn return value when returnByValue is true.
 *
 * @param value - CDP response body.
 * @returns Parsed value or undefined.
 */
function readCallFunctionValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  if (!('result' in value)) {
    return undefined;
  }
  const result = value.result;
  if (typeof result !== 'object' || result === null) {
    return undefined;
  }
  if (!('value' in result)) {
    return undefined;
  }
  return result.value;
}

/**
 * Pushes into a ring buffer capped at DIAGNOSTICS_CAP.
 *
 * @param buffer - Mutable array.
 * @param entry - New entry.
 */
function pushRing(buffer: DiagnosticEntry[], entry: DiagnosticEntry): void {
  buffer.push(entry);
  while (buffer.length > DIAGNOSTICS_CAP) {
    buffer.shift();
  }
}

/**
 * Returns (or creates) the diagnostics buffer for a page.
 *
 * @param page - Puppeteer page.
 * @returns Buffer object.
 */
function diagnosticsBufferFor(page: Page): {
  console: DiagnosticEntry[];
  pageExceptions: DiagnosticEntry[];
  failedRequests: DiagnosticEntry[];
} {
  let buf = diagnosticsByPage.get(page);
  if (buf === undefined) {
    buf = {console: [], pageExceptions: [], failedRequests: []};
    diagnosticsByPage.set(page, buf);
  }
  return buf;
}

/**
 * Attaches console/pageerror/requestfailed listeners once per page.
 *
 * Why: Reconnecting must not duplicate listeners (ROUND2 lesson); Set tracks
 * pages already wired so getActivePage can lazily attach.
 *
 * @param page - Puppeteer page.
 * @returns void
 * @throws Never throws.
 */
export function attachPageDiagnostics(page: Page): void {
  if (diagnosticsAttached.has(page)) {
    return;
  }
  diagnosticsAttached.add(page);
  const buf = diagnosticsBufferFor(page);

  page.on('console', msg => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warn') {
      return;
    }
    const level = type === 'warn' ? 'warn' : 'error';
    pushRing(buf.console, {
      message: msg.text(),
      level,
      timestampMs: Date.now(),
    });
  });

  page.on('pageerror', err => {
    const message = err instanceof Error ? err.message : String(err);
    pushRing(buf.pageExceptions, {
      message,
      level: 'pageerror',
      timestampMs: Date.now(),
    });
  });

  page.on('requestfailed', req => {
    const failure = req.failure();
    const reason =
      failure !== null && failure.errorText.length > 0
        ? failure.errorText
        : 'failed';
    pushRing(buf.failedRequests, {
      message: `${req.method()} ${req.url()} → ${reason}`,
      level: 'request',
      timestampMs: Date.now(),
      url: req.url(),
    });
  });
}

/**
 * Returns recent diagnostic entries for page_status.
 *
 * @param page - Puppeteer page.
 * @param limit - Max entries per category (default 5).
 * @returns Recent console errors, exceptions, and failed requests.
 * @throws Never throws.
 */
export function getPageDiagnostics(page: Page, limit = 5): PageDiagnostics {
  attachPageDiagnostics(page);
  const buf = diagnosticsBufferFor(page);
  const take = (entries: DiagnosticEntry[]): DiagnosticEntry[] => {
    if (entries.length <= limit) {
      return [...entries];
    }
    return entries.slice(entries.length - limit);
  };
  return {
    consoleErrors: take(buf.console),
    pageExceptions: take(buf.pageExceptions),
    failedRequests: take(buf.failedRequests),
  };
}

/**
 * Clears accumulated diagnostics for a page.
 *
 * @param page - Puppeteer page.
 * @returns void
 * @throws Never throws.
 */
export function clearPageDiagnostics(page: Page): void {
  const buf = diagnosticsByPage.get(page);
  if (buf === undefined) {
    return;
  }
  buf.console.length = 0;
  buf.pageExceptions.length = 0;
  buf.failedRequests.length = 0;
}

/**
 * Clears attach tracking (called from disconnectBrowser).
 *
 * With a WeakSet this is a no-op: page objects are released by GC once the
 * browser disconnects and references drop, so attach state clears itself.
 * The function stays for API compatibility (tests / disconnect path).
 *
 * @returns void
 * @throws Never throws.
 */
export function resetDiagnosticsAttachmentState(): void {
  // WeakSet has no clear(); GC handles release. Intentionally empty.
}

/**
 * CDP function body: read tagName, form state, geometry, selector.
 */
const DOM_STATE_READER_FUNCTION = String.raw`function() {
  const el = this;
  if (!el || el.nodeType !== 1) return null;
  const countMatches = (selector) => document.querySelectorAll(selector).length;
  const firstUnique = (candidates) => {
    for (const sel of candidates) {
      if (sel.length > 0 && countMatches(sel) === 1) return sel;
    }
    return '';
  };
  const buildSelector = () => {
    const testId = el.getAttribute('data-testid');
    if (testId) {
      const hit = firstUnique(['[data-testid="' + testId + '"]']);
      if (hit) return hit;
    }
    if (el.id) {
      const hit = firstUnique(['#' + el.id]);
      if (hit) return hit;
    }
    const classSegments = [];
    let current = el;
    while (current) {
      const tag = current.tagName.toLowerCase();
      let cls = '';
      for (const name of current.classList) {
        if (name) cls += '.' + name;
      }
      classSegments.unshift(tag + cls);
      current = current.parentElement;
    }
    const classChain = classSegments.join(' > ');
    if (classChain) {
      const hit = firstUnique([classChain]);
      if (hit) return hit;
    }
    const tagHit = firstUnique([el.tagName.toLowerCase()]);
    if (tagHit) return tagHit;
    const nthSegments = [];
    current = el;
    while (current) {
      const tag = current.tagName.toLowerCase();
      let nth = 1;
      const parent = current.parentElement;
      if (parent) {
        for (const sibling of parent.children) {
          if (sibling.tagName === current.tagName) {
            if (sibling === current) break;
            nth += 1;
          }
        }
      }
      nthSegments.unshift(tag + ':nth-of-type(' + nth + ')');
      current = current.parentElement;
    }
    return firstUnique([nthSegments.join(' > ')]);
  };
  const rect = el.getBoundingClientRect();
  let text = el.textContent || '';
  if (text.length > 200) text = text.slice(0, 200) + '…';
  const out = {
    tagName: el.tagName.toLowerCase(),
    visible: !!(el.offsetParent || (rect.width > 0 && rect.height > 0)),
    cssSelector: buildSelector(),
    textContent: text || undefined,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
  };
  if (el instanceof HTMLInputElement) {
    if (el.value) out.value = el.value;
    if (el.type === 'checkbox' || el.type === 'radio') out.checked = el.checked;
    if (el.placeholder) out.placeholder = el.placeholder;
    out.disabled = el.disabled;
  } else if (el instanceof HTMLTextAreaElement) {
    if (el.value) out.value = el.value;
    if (el.placeholder) out.placeholder = el.placeholder;
    out.disabled = el.disabled;
  } else if (el instanceof HTMLSelectElement) {
    out.value = el.value;
    out.disabled = el.disabled;
  } else if (el.hasAttribute && el.hasAttribute('disabled')) {
    out.disabled = true;
  }
  return out;
}`;

/**
 * Resolves backendNodeId to objectId via CDP DOM.resolveNode, keeping the
 * session that created the objectId so callers can reuse it.
 *
 * Why: CDP objectIds are bound to the session that created them. A fresh
 * session calling Runtime.callFunctionOn with an objectId from another
 * session fails with "Could not find object with given id" — the root cause
 * of R4-1 (DOM lookup always returned undefined).
 *
 * @param page - Puppeteer page.
 * @param backendNodeId - Chromium backend node id.
 * @returns The CDP session and objectId, or undefined when stale / missing.
 */
async function resolveBackendNodeObjectId(
  page: Page,
  backendNodeId: number,
): Promise<{client: CDPSession; objectId: string} | undefined> {
  try {
    const client = await page.createCDPSession();
    await client.send('DOM.enable');
    const resolved: unknown = await client.send('DOM.resolveNode', {
      backendNodeId,
    });
    const objectId = readResolveObjectId(resolved);
    if (objectId === undefined) {
      await client.detach().catch(() => {});
      return undefined;
    }
    return {client, objectId};
  } catch {
    return undefined;
  }
}

/**
 * Queries live DOM state for a snapshot backendNodeId.
 *
 * Why: checked/placeholder are not in the AX snapshot; CDP resolve survives
 * until navigation invalidates backend ids.
 *
 * @param page - Puppeteer page.
 * @param backendNodeId - Chromium backend node id from the AX tree.
 * @returns DOM facts or undefined when the node cannot be resolved.
 * @throws Never throws — failures become undefined for tool-layer fallbacks.
 */
export async function queryDomByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<DomNodeState | undefined> {
  const resolved = await resolveBackendNodeObjectId(page, backendNodeId);
  if (resolved === undefined) {
    return undefined;
  }
  const {client, objectId} = resolved;
  try {
    const raw: unknown = await client.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: DOM_STATE_READER_FUNCTION,
      returnByValue: true,
    });
    const value = readCallFunctionValue(raw);
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    return parseDomNodeState(value);
  } catch {
    return undefined;
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Parses callFunctionOn JSON into DomNodeState.
 *
 * @param value - Plain object from the browser.
 * @returns DomNodeState or undefined when shape is invalid.
 */
function parseDomNodeState(value: object): DomNodeState | undefined {
  if (!('tagName' in value) || typeof value.tagName !== 'string') {
    return undefined;
  }
  if (!('visible' in value) || typeof value.visible !== 'boolean') {
    return undefined;
  }
  if (!('cssSelector' in value) || typeof value.cssSelector !== 'string') {
    return undefined;
  }
  const state: DomNodeState = {
    tagName: value.tagName,
    cssSelector: value.cssSelector,
    visible: value.visible,
  };
  if ('value' in value && typeof value.value === 'string') {
    state.value = value.value;
  }
  if ('checked' in value && typeof value.checked === 'boolean') {
    state.checked = value.checked;
  }
  if ('placeholder' in value && typeof value.placeholder === 'string') {
    state.placeholder = value.placeholder;
  }
  if ('disabled' in value && typeof value.disabled === 'boolean') {
    state.disabled = value.disabled;
  }
  if ('textContent' in value && typeof value.textContent === 'string') {
    state.textContent = value.textContent;
  }
  if (
    'rect' in value &&
    typeof value.rect === 'object' &&
    value.rect !== null
  ) {
    const rect = value.rect;
    if (
      'top' in rect &&
      typeof rect.top === 'number' &&
      'left' in rect &&
      typeof rect.left === 'number' &&
      'width' in rect &&
      typeof rect.width === 'number' &&
      'height' in rect &&
      typeof rect.height === 'number'
    ) {
      state.rect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    }
  }
  return state;
}

/**
 * Builds a unique CSS selector for a backend node id.
 *
 * @param page - Puppeteer page.
 * @param backendNodeId - Chromium backend node id.
 * @returns Selector string or undefined when not uniquely resolvable.
 * @throws Never throws.
 */
export async function elementToSelector(
  page: Page,
  backendNodeId: number,
): Promise<string | undefined> {
  const dom = await queryDomByBackendNodeId(page, backendNodeId);
  if (dom === undefined) {
    return undefined;
  }
  if (dom.cssSelector.length === 0) {
    return undefined;
  }
  return dom.cssSelector;
}

/**
 * Reads document readyState and a simplified loading flag.
 *
 * @param page - Puppeteer page.
 * @returns URL, title, readyState, loading.
 * @throws When evaluate fails.
 */
export async function readPageLifecycle(page: Page): Promise<{
  url: string;
  title: string;
  readyState: string;
  loading: boolean;
}> {
  attachPageDiagnostics(page);
  const title = await page.title();
  const evaluated = await page.evaluate(() => {
    const rs = document.readyState;
    const loading = rs === 'loading' || rs === 'interactive';
    return {readyState: rs, loading};
  });
  return {
    url: page.url(),
    title,
    readyState: evaluated.readyState,
    loading: evaluated.loading,
  };
}

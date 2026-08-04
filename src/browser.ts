/**
 * Puppeteer-core browser connection management.
 * THIS IS THE ONLY MODULE THAT IMPORTS puppeteer-core.
 *
 * Why: Isolating browser I/O here keeps src/core/ pure and unit-testable, and
 * lets tools.test.ts mock this module without launching Chrome.
 */

import puppeteer from 'puppeteer-core';
import type {Browser, Page, SerializedAXNode} from 'puppeteer-core';

import {loadConfig} from './config.js';
import type {ElementVisibilityInfo, RawAxNode} from './types.js';

let browserInstance: Browser | undefined;
let connectError: string | undefined;

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
 * Connects to the browser (singleton), reconnecting once on failure.
 *
 * @returns Connected Browser.
 * @throws Error when connection fails after retry.
 */
export async function connectBrowser(): Promise<Browser> {
  const config = loadConfig();
  if (browserInstance !== undefined && browserInstance.connected) {
    return browserInstance;
  }

  try {
    browserInstance = await openConnection(
      config.wsEndpoint,
      config.browserURL,
    );
    connectError = undefined;
    return browserInstance;
  } catch (firstErr) {
    // One automatic reconnect attempt per SPEC.
    try {
      browserInstance = await openConnection(
        config.wsEndpoint,
        config.browserURL,
      );
      connectError = undefined;
      return browserInstance;
    } catch (secondErr) {
      const msg = errorMessage(secondErr);
      const endpoint = config.wsEndpoint ?? config.browserURL;
      connectError = `Failed to connect to browser at ${endpoint}: ${msg}`;
      throw new Error(connectError, {cause: firstErr});
    }
  }
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
      // disconnect() returns a promise; cleanup is fire-and-forget here.
      void browserInstance.disconnect();
    } catch {
      // ignore disconnect errors during cleanup
    }
    browserInstance = undefined;
  }
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
  axRoot: SerializedAXNode,
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
  node: SerializedAXNode,
  map: Map<number, ElementVisibilityInfo>,
): Promise<void> {
  // backendNodeId is not part of the public SerializedAXNode type; narrow it
  // safely with `in` + typeof (no banned assertions).
  if ('backendNodeId' in node && typeof node.backendNodeId === 'number') {
    try {
      const handle = await node.elementHandle();
      if (handle !== null) {
        const geo: EvaluatedGeometry = await handle.evaluate(el => {
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
        await handle.dispose();
      }
    } catch {
      // Skip nodes whose handles are stale; treat as unknown visibility.
    }
  }
  if (node.children !== undefined) {
    for (const child of node.children) {
      await walkAxForVisibility(child, map);
    }
  }
}

/**
 * Fetches AX tree and visibility info in one pass (reuses the same snapshot).
 *
 * @param page - Puppeteer page.
 * @returns Raw tree plus visibility keyed by backendNodeId.
 * @throws When accessibility snapshot fails.
 */
export async function fetchAxTreeWithVisibility(page: Page): Promise<{
  raw: RawAxNode | null;
  visibilityByBackendId: Map<number, ElementVisibilityInfo>;
}> {
  const snapshot = await page.accessibility.snapshot({
    interestingOnly: true,
    includeIframes: true,
  });
  if (snapshot === null) {
    return {raw: null, visibilityByBackendId: new Map()};
  }
  const visibilityByBackendId = await collectVisibilityByBackendId(snapshot);
  return {raw: snapshotToRaw(snapshot), visibilityByBackendId};
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

/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MCP tool-level integration tests with a mocked browser layer.
 */

import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {ElementVisibilityInfo, RawAxNode} from '../src/types.js';

/**
 * Default visibility facts for mocked AX nodes in tool tests.
 */
function defaultVisibleInfo(): ElementVisibilityInfo {
  return {
    display: 'block',
    visibility: 'visible',
    opacity: 1,
    rect: {
      top: 0,
      left: 0,
      bottom: 100,
      right: 100,
      width: 100,
      height: 100,
    },
    viewportWidth: 1280,
    viewportHeight: 720,
  };
}

/**
 * Maps backend ids from the default mock AX tree to visible geometry.
 */
function defaultMockVisibilityMap(): Map<number, ElementVisibilityInfo> {
  const info = defaultVisibleInfo();
  const map = new Map<number, ElementVisibilityInfo>();
  map.set(1, info);
  map.set(12, info);
  map.set(15, info);
  return map;
}

/**
 * Default AX tree shared by most tool tests: a Compose button and an Inbox
 * link under a RootWebArea. Extracted so beforeEach can reset mockState.raw
 * after tests that mutate it (order-independent tests).
 *
 * @returns Fresh RawAxNode tree.
 */
function defaultMockRawTree(): RawAxNode {
  return {
    role: 'RootWebArea',
    name: 'example.com',
    backendDOMNodeId: 1,
    children: [
      {
        role: 'button',
        name: 'Compose',
        backendDOMNodeId: 12,
        children: [],
      },
      {
        role: 'link',
        name: 'Inbox',
        backendDOMNodeId: 15,
        children: [],
      },
    ],
  };
}

const {
  getActivePage,
  fetchAxTreeWithVisibility,
  takeScreenshotToPath,
  queryDomByBackendNodeId,
  elementToSelector,
  readPageLifecycle,
  getPageDiagnostics,
  clearPageDiagnostics,
  attachPageDiagnostics,
  mockState,
} = vi.hoisted(() => {
  const mockState: {
    hasPage: boolean;
    raw: RawAxNode;
    visibilityByBackendId: Map<number, ElementVisibilityInfo>;
    screenshotPathWritten: string;
  } = {
    hasPage: true,
    raw: defaultMockRawTree(),
    visibilityByBackendId: defaultMockVisibilityMap(),
    screenshotPathWritten: '',
  };

  return {
    mockState,
    getActivePage: vi.fn(async () => {
      if (!mockState.hasPage) {
        throw new Error(
          'No active page available (all pages are blank or DevTools)',
        );
      }
      return {
        page: {
          url: () => 'https://example.com',
        },
        url: 'https://example.com',
      };
    }),
    fetchAxTreeWithVisibility: vi.fn(async () => ({
      raw: mockState.raw,
      visibilityByBackendId: mockState.visibilityByBackendId,
      visibilitySkipped: false,
    })),
    takeScreenshotToPath: vi.fn(
      async (
        _page: unknown,
        filePath: string,
        _format: string,
        _quality: number,
        _fullPage: boolean,
      ) => {
        mockState.screenshotPathWritten = filePath;
        // Touch the file so callers can verify the path is usable.
        const {writeFile} = await import('node:fs/promises');
        await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return filePath;
      },
    ),
    queryDomByBackendNodeId: vi.fn(
      async (): Promise<
        | {
            tagName: string;
            cssSelector: string;
            visible: boolean;
            disabled: boolean;
            rect: {top: number; left: number; width: number; height: number};
          }
        | undefined
      > => ({
        tagName: 'button',
        cssSelector: '[data-testid="compose"]',
        visible: true,
        disabled: false,
        rect: {top: 1, left: 2, width: 80, height: 32},
      }),
    ),
    elementToSelector: vi.fn(async () => '[data-testid="compose"]'),
    readPageLifecycle: vi.fn(async () => ({
      url: 'https://example.com',
      title: 'Example',
      readyState: 'complete',
      loading: false,
    })),
    getPageDiagnostics: vi.fn(() => ({
      consoleErrors: [
        {
          message: 'Failed to load resource: 404',
          level: 'error' as const,
          timestampMs: Date.now() - 120_000,
        },
      ],
      pageExceptions: [],
      failedRequests: [],
    })),
    clearPageDiagnostics: vi.fn(),
    attachPageDiagnostics: vi.fn(),
  };
});

vi.mock('../src/browser.js', () => ({
  getActivePage,
  fetchAxTreeWithVisibility,
  takeScreenshotToPath,
  queryDomByBackendNodeId,
  elementToSelector,
  readPageLifecycle,
  getPageDiagnostics,
  clearPageDiagnostics,
  attachPageDiagnostics,
  connectBrowser: vi.fn(),
  disconnectBrowser: vi.fn(),
  fetchAxTree: vi.fn(),
  collectVisibilityByBackendId: vi.fn(),
  getLastConnectError: vi.fn(() => undefined),
}));

import {resetDiffHistory} from '../src/core/diff.js';
import {defaultUidMapper} from '../src/core/uid.js';
import {readPackageVersion} from '../src/version.js';
import {handleElementToSelector} from '../src/tools/element_to_selector.js';
import {handleGetNode} from '../src/tools/get_node.js';
import {handlePageSearch} from '../src/tools/page_search.js';
import {handlePageStatus} from '../src/tools/page_status.js';
import {handleScreenshotToDisk} from '../src/tools/screenshot_to_disk.js';
import {handleSmartSnapshot} from '../src/tools/smart_snapshot.js';
import {handleSnapshotDiff} from '../src/tools/snapshot_diff.js';
import {clearSnapshotUidCache} from '../src/tools/snapshot-uid-cache.js';
import {getLastConnectError} from '../src/browser.js';

describe('tools', () => {
  beforeEach(() => {
    resetDiffHistory();
    clearSnapshotUidCache();
    defaultUidMapper.reset();
    mockState.hasPage = true;
    mockState.raw = defaultMockRawTree();
    mockState.visibilityByBackendId = defaultMockVisibilityMap();
    getActivePage.mockClear();
    fetchAxTreeWithVisibility.mockClear();
    takeScreenshotToPath.mockClear();
    queryDomByBackendNodeId.mockClear();
    elementToSelector.mockClear();
    readPageLifecycle.mockClear();
    getPageDiagnostics.mockClear();
    clearPageDiagnostics.mockClear();
    attachPageDiagnostics.mockClear();
    vi.mocked(getLastConnectError).mockReturnValue(undefined);
  });

  it('smart_snapshotShouldUseEnvDefaultMaxDepthWhenOmitted', async () => {
    vi.stubEnv('CDT_MAX_DEPTH', '3');
    const vis = defaultVisibleInfo();
    mockState.visibilityByBackendId = new Map([
      [1, vis],
      [2, vis],
      [3, vis],
      [4, vis],
      [5, vis],
    ]);
    mockState.raw = {
      role: 'RootWebArea',
      name: 'deep',
      backendDOMNodeId: 1,
      children: [
        {
          role: 'article',
          name: 'L0',
          backendDOMNodeId: 2,
          children: [
            {
              role: 'article',
              name: 'L1',
              backendDOMNodeId: 3,
              children: [
                {
                  role: 'article',
                  name: 'L2',
                  backendDOMNodeId: 4,
                  children: [
                    {
                      role: 'link',
                      name: 'Leaf',
                      backendDOMNodeId: 5,
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    try {
      const result = await handleSmartSnapshot({});
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('[+]');
    } finally {
      mockState.raw = {
        role: 'RootWebArea',
        name: 'example.com',
        backendDOMNodeId: 1,
        children: [
          {
            role: 'button',
            name: 'Compose',
            backendDOMNodeId: 12,
            children: [],
          },
          {
            role: 'link',
            name: 'Inbox',
            backendDOMNodeId: 15,
            children: [],
          },
        ],
      };
      vi.unstubAllEnvs();
    }
  });

  it('smart_snapshotShouldReturnTextContent', async () => {
    const result = await handleSmartSnapshot({});
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('example.com');
    expect(text).toContain('[button]');
    expect(text).toContain('Compose');
  });

  it('smart_snapshotShouldReturnErrorWhenNoPage', async () => {
    mockState.hasPage = false;
    const result = await handleSmartSnapshot({});
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toMatch(/No active page|Failed to connect/i);
  });

  it('snapshot_diffShouldReturnInitialOnFirstCall', async () => {
    const result = await handleSnapshotDiff({});
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('(initial snapshot, no diff available)');
    expect(text).toContain('example.com');
  });

  it('screenshot_to_diskShouldReturnFilePath', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdt-ss-'));
    vi.stubEnv('CDT_SNAPSHOT_DIR', dir);
    try {
      const result = await handleScreenshotToDisk({
        format: 'png',
      });
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '';
      expect(text).toMatch(/^Screenshot saved to: /);
      const filePath = text.replace('Screenshot saved to: ', '');
      expect(filePath.startsWith(dir)).toBe(true);
      const bytes = await readFile(filePath);
      expect(bytes.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, {recursive: true, force: true});
      vi.unstubAllEnvs();
    }
  });

  it('screenshot_to_diskShouldCreateDirectory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'cdt-ss-parent-'));
    vi.stubEnv('CDT_SNAPSHOT_DIR', parent);
    const nested = join(parent, 'nested', 'shots');
    try {
      // Ensure nested path does not exist yet (inside allowed root).
      const result = await handleScreenshotToDisk({
        directory: nested,
        format: 'png',
      });
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '';
      const filePath = text.replace('Screenshot saved to: ', '');
      expect(filePath.startsWith(nested)).toBe(true);
      const bytes = await readFile(filePath);
      expect(bytes.length).toBeGreaterThan(0);
    } finally {
      await rm(parent, {recursive: true, force: true});
      vi.unstubAllEnvs();
    }
  });

  it('shouldSerializeConcurrentSnapshotDiffCalls', async () => {
    const order: string[] = [];
    fetchAxTreeWithVisibility.mockImplementation(async () => {
      order.push('fetch-start');
      await new Promise<void>(resolve => {
        setTimeout(resolve, 30);
      });
      order.push('fetch-end');
      return {
        raw: mockState.raw,
        visibilityByBackendId: mockState.visibilityByBackendId,
        visibilitySkipped: false,
      };
    });

    const first = handleSnapshotDiff({});
    const second = handleSnapshotDiff({});
    await Promise.all([first, second]);

    expect(order).toEqual([
      'fetch-start',
      'fetch-end',
      'fetch-start',
      'fetch-end',
    ]);
    const secondText = (await second).content[0]?.text ?? '';
    expect(secondText).not.toContain('initial snapshot');
  });

  it('shouldReturnPackageVersionFromReadPackageVersion', () => {
    const pkg = readPackageVersion();
    expect(pkg).toMatch(/^\d+\.\d+\.\d+/);
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const version = parsed.version;
      if (typeof version === 'string') {
        expect(pkg).toBe(version);
      }
    }
  });

  it('shouldPreferLastConnectErrorInSmartSnapshotFailure', async () => {
    vi.mocked(getLastConnectError).mockReturnValue(
      'Failed to connect to browser at http://127.0.0.1:9222: refused',
    );
    getActivePage.mockRejectedValueOnce(new Error('generic'));
    const result = await handleSmartSnapshot({});
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Failed to connect to browser');
  });

  it('shouldIncludeLandmarksWhenSnapshotDiffVerboseTrue', async () => {
    mockState.raw = {
      role: 'RootWebArea',
      name: 'example.com',
      backendDOMNodeId: 1,
      children: [
        {
          role: 'navigation',
          name: 'Main',
          backendDOMNodeId: 20,
          children: [
            {
              role: 'link',
              name: 'Home',
              backendDOMNodeId: 21,
              children: [],
            },
          ],
        },
      ],
    };
    mockState.visibilityByBackendId = new Map([
      [1, defaultVisibleInfo()],
      [20, defaultVisibleInfo()],
      [21, defaultVisibleInfo()],
    ]);
    const result = await handleSnapshotDiff({verbose: true});
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('[navigation]');
  });

  it('shouldRejectScreenshotDirectoryOutsideAllowedRoot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdt-ss-allowed-'));
    try {
      vi.stubEnv('CDT_SNAPSHOT_DIR', dir);
      const result = await handleScreenshotToDisk({
        directory: join(tmpdir(), 'cdt-ss-outside'),
        format: 'png',
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('must be under');
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('pageSearchShouldErrorWhenIndexEmpty', async () => {
    const result = await handlePageSearch({keyword: 'Compose'});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No snapshot yet');
  });

  it('pageSearchShouldReturnMatchesAfterSnapshot', async () => {
    await handleSmartSnapshot({});
    const result = await handlePageSearch({keyword: 'compose'});
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Found');
    expect(text).toContain('uid=');
    expect(text).toContain('Compose');
  });

  it('pageSearchShouldReportNoMatchesWhenKeywordMissing', async () => {
    await handleSmartSnapshot({});
    const result = await handlePageSearch({keyword: 'zzznomatch'});
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('No matches');
  });

  it('pageSearchShouldTruncateWithMoreLineWhenMaxResultsExceeded', async () => {
    const vis = defaultVisibleInfo();
    const children: RawAxNode[] = [];
    for (let i = 0; i < 10; i++) {
      children.push({
        role: 'link',
        name: `search item ${String(i)}`,
        backendDOMNodeId: 100 + i,
        children: [],
      });
    }
    mockState.raw = {
      role: 'RootWebArea',
      name: 'example.com',
      backendDOMNodeId: 1,
      children,
    };
    const visMap = new Map<number, ElementVisibilityInfo>();
    visMap.set(1, vis);
    for (let i = 0; i < 10; i++) {
      visMap.set(100 + i, vis);
    }
    mockState.visibilityByBackendId = visMap;
    try {
      await handleSmartSnapshot({});
      const result = await handlePageSearch({keyword: 'search', maxResults: 3});
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('... and');
    } finally {
      mockState.raw = {
        role: 'RootWebArea',
        name: 'example.com',
        backendDOMNodeId: 1,
        children: [
          {
            role: 'button',
            name: 'Compose',
            backendDOMNodeId: 12,
            children: [],
          },
          {
            role: 'link',
            name: 'Inbox',
            backendDOMNodeId: 15,
            children: [],
          },
        ],
      };
      mockState.visibilityByBackendId = defaultMockVisibilityMap();
    }
  });

  it('getNodeShouldReturnDetailsWhenUidFound', async () => {
    await handleSmartSnapshot({});
    const result = await handleGetNode({uid: 2});
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('uid=2');
    expect(text).toContain('cssSelector:');
  });

  it('getNodeShouldErrorWhenUidNotInIndex', async () => {
    await handleSmartSnapshot({});
    const result = await handleGetNode({uid: 99999});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
  });

  it('getNodeShouldDegradeWhenDomStateUnavailable', async () => {
    await handleSmartSnapshot({});
    queryDomByBackendNodeId.mockResolvedValueOnce(undefined);
    const result = await handleGetNode({uid: 2});
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('domState: unavailable');
  });

  it('elementToSelectorShouldReturnSelectorWhenUidFound', async () => {
    await handleSmartSnapshot({});
    const result = await handleElementToSelector({uid: 2});
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('[data-testid="compose"]');
  });

  it('elementToSelectorShouldErrorWhenUidMissing', async () => {
    await handleSmartSnapshot({});
    const result = await handleElementToSelector({uid: 888});
    expect(result.isError).toBe(true);
  });

  it('pageStatusShouldReturnLifecycleAndDiagnostics', async () => {
    const result = await handlePageStatus({});
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('URL: https://example.com');
    expect(text).toContain('readyState: complete');
    expect(text).toContain('Console errors');
    expect(text).toContain('404');
  });

  it('pageStatusShouldClearDiagnosticsWhenClearTrue', async () => {
    await handlePageStatus({clear: true});
    expect(clearPageDiagnostics).toHaveBeenCalled();
  });
});

/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MCP tool-level integration tests with a mocked browser layer.
 */

import {mkdtemp, readFile, rm} from 'node:fs/promises';
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

const {
  getActivePage,
  fetchAxTreeWithVisibility,
  takeScreenshotToPath,
  mockState,
} = vi.hoisted(() => {
  const mockState: {
    hasPage: boolean;
    raw: RawAxNode;
    visibilityByBackendId: Map<number, ElementVisibilityInfo>;
    screenshotPathWritten: string;
  } = {
    hasPage: true,
    raw: {
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
    },
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
  };
});

vi.mock('../src/browser.js', () => ({
  getActivePage,
  fetchAxTreeWithVisibility,
  takeScreenshotToPath,
  connectBrowser: vi.fn(),
  disconnectBrowser: vi.fn(),
  fetchAxTree: vi.fn(),
  collectVisibilityByBackendId: vi.fn(),
  getLastConnectError: vi.fn(),
}));

import {resetDiffHistory} from '../src/core/diff.js';
import {defaultUidMapper} from '../src/core/uid.js';
import {handleScreenshotToDisk} from '../src/tools/screenshot_to_disk.js';
import {handleSmartSnapshot} from '../src/tools/smart_snapshot.js';
import {handleSnapshotDiff} from '../src/tools/snapshot_diff.js';

describe('tools', () => {
  beforeEach(() => {
    resetDiffHistory();
    defaultUidMapper.reset();
    mockState.hasPage = true;
    mockState.visibilityByBackendId = defaultMockVisibilityMap();
    getActivePage.mockClear();
    fetchAxTreeWithVisibility.mockClear();
    takeScreenshotToPath.mockClear();
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
    try {
      const result = await handleScreenshotToDisk({
        directory: dir,
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
    }
  });

  it('screenshot_to_diskShouldCreateDirectory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'cdt-ss-parent-'));
    const nested = join(parent, 'nested', 'shots');
    try {
      // Ensure nested path does not exist yet.
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
    }
  });
});

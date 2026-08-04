/** @license
 * Copyright 2026 WANG Xinhe
 * SPDX-License-Identifier: Apache-2.0
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

const {connectMock} = vi.hoisted(() => ({
  connectMock: vi.fn(),
}));

vi.mock('puppeteer-core', () => ({
  default: {
    connect: connectMock,
  },
}));

/**
 * Minimal browser handle exercised by connectBrowser tests.
 */
interface MockBrowserHandle {
  connected: boolean;
  on: (event: string, handler: () => void) => void;
  disconnect: () => Promise<void>;
}

/**
 * Builds a mock browser with disconnect event support.
 *
 * @returns Mock browser handle.
 */
function makeMockBrowser(): MockBrowserHandle {
  const disconnectedHandlers: Array<() => void> = [];
  const browser: MockBrowserHandle = {
    connected: true,
    on: (event: string, handler: () => void) => {
      if (event === 'disconnected') {
        disconnectedHandlers.push(handler);
      }
    },
    disconnect: async () => {
      browser.connected = false;
      for (const handler of disconnectedHandlers) {
        handler();
      }
    },
  };
  return browser;
}

describe('browser connect', () => {
  beforeEach(async () => {
    vi.resetModules();
    connectMock.mockReset();
    const {disconnectBrowser} = await import('../src/browser.js');
    await disconnectBrowser();
  });

  it('shouldReuseSingleConnectForConcurrentCalls', async () => {
    // Placeholder resolver replaced below by the real one from the pending
    // promise; initial value must be callable so TS sees it as initialized.
    let resolveConnect: (browser: MockBrowserHandle) => void = () => {
      /* replaced by real resolver below */
    };
    const pending = new Promise<MockBrowserHandle>(resolve => {
      resolveConnect = resolve;
    });
    const mockBrowser = makeMockBrowser();
    connectMock.mockReturnValue(pending);

    const {connectBrowser} = await import('../src/browser.js');
    const first = connectBrowser();
    const second = connectBrowser();
    expect(connectMock).toHaveBeenCalledTimes(1);

    resolveConnect(mockBrowser);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(mockBrowser);
    expect(b).toBe(mockBrowser);
  });

  it('shouldClearSingletonWhenBrowserDisconnects', async () => {
    const mockBrowser = makeMockBrowser();
    connectMock.mockResolvedValue(mockBrowser);

    const {connectBrowser} = await import('../src/browser.js');
    const first = await connectBrowser();
    expect(first).toBe(mockBrowser);

    await mockBrowser.disconnect();
    expect(mockBrowser.connected).toBe(false);

    const mockBrowser2 = makeMockBrowser();
    connectMock.mockResolvedValue(mockBrowser2);
    const second = await connectBrowser();
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(second).toBe(mockBrowser2);
  });
});

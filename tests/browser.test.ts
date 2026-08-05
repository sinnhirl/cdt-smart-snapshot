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

  it('shouldDisconnectStaleBrowserBeforeReconnectWhenNotConnected', async () => {
    const stale = makeMockBrowser();
    connectMock.mockResolvedValueOnce(stale);

    const {connectBrowser} = await import('../src/browser.js');
    await connectBrowser();
    stale.connected = false;
    const disconnectSpy = vi.spyOn(stale, 'disconnect');

    const fresh = makeMockBrowser();
    connectMock.mockResolvedValueOnce(fresh);
    const reconnected = await connectBrowser();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(reconnected).toBe(fresh);
  });

  it('shouldAwaitDisconnectBeforeClearingSingleton', async () => {
    let disconnected = false;
    const mockBrowser = makeMockBrowser();
    mockBrowser.disconnect = async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 10);
      });
      disconnected = true;
      mockBrowser.connected = false;
    };
    connectMock.mockResolvedValue(mockBrowser);

    const {connectBrowser, disconnectBrowser} =
      await import('../src/browser.js');
    await connectBrowser();
    await disconnectBrowser();
    expect(disconnected).toBe(true);
    expect(mockBrowser.connected).toBe(false);
  });
});

describe('walkAx visibility dispose', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shouldDisposeElementHandleWhenEvaluateThrows', async () => {
    const disposeMock = vi.fn(async () => undefined);
    const axNode = {
      role: 'button',
      name: 'X',
      backendNodeId: 7,
      elementHandle: async () => ({
        evaluate: async () => {
          throw new Error('evaluate failed');
        },
        dispose: disposeMock,
      }),
    };
    const {collectVisibilityByBackendId} = await import('../src/browser.js');
    const map = await collectVisibilityByBackendId(axNode);
    expect(map.size).toBe(0);
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });
});

describe('page diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /**
   * Builds a mock browser whose pages() returns a single page with an
   * `on` method that records handlers by event name.
   */
  function makeDiagnosticsBrowser(
    handlers: Record<string, Array<(arg: unknown) => void>>,
  ): MockBrowserHandle & {
    pages: () => Promise<
      Array<{
        url: () => string;
        on: (event: string, handler: (arg: unknown) => void) => void;
      }>
    >;
  } {
    const base = makeMockBrowser();
    // One stable page object across calls — getActivePage's attachPageDiagnostics
    // dedupes by identity (Set), so the same object must be returned every time.
    const page = {
      url: () => 'https://example.com',
      on: (event: string, handler: (arg: unknown) => void) => {
        const list = handlers[event];
        if (list !== undefined) {
          list.push(handler);
        }
      },
    };
    return {
      ...base,
      pages: async () => [page],
    };
  }

  it('shouldAttachPageDiagnosticsOnlyOncePerPage', async () => {
    const handlers: Record<string, Array<(arg: unknown) => void>> = {
      console: [],
      pageerror: [],
      requestfailed: [],
    };
    connectMock.mockResolvedValue(makeDiagnosticsBrowser(handlers));

    const {getActivePage, resetDiagnosticsAttachmentState} =
      await import('../src/browser.js');
    resetDiagnosticsAttachmentState();
    // First getActivePage attaches listeners on the active page.
    await getActivePage();
    const attachedOnce = {
      console: handlers.console.length,
      pageerror: handlers.pageerror.length,
      requestfailed: handlers.requestfailed.length,
    };
    // Second call must not duplicate listeners.
    await getActivePage();
    expect(handlers.console.length).toBe(attachedOnce.console);
    expect(handlers.pageerror.length).toBe(attachedOnce.pageerror);
    expect(handlers.requestfailed.length).toBe(attachedOnce.requestfailed);
    expect(attachedOnce.console).toBe(1);
  });

  it('shouldAccumulateAndClearPageDiagnostics', async () => {
    const handlers: Record<string, Array<(arg: unknown) => void>> = {
      console: [],
      pageerror: [],
      requestfailed: [],
    };
    connectMock.mockResolvedValue(makeDiagnosticsBrowser(handlers));

    const {getActivePage, getPageDiagnostics, clearPageDiagnostics} =
      await import('../src/browser.js');
    await getActivePage();
    const consoleHandler = handlers.console[0];
    expect(consoleHandler).toBeDefined();
    if (consoleHandler !== undefined) {
      consoleHandler({
        type: () => 'error',
        text: () => 'boom',
      });
    }
    const {page} = await getActivePage();
    const diag = getPageDiagnostics(page, 5);
    expect(diag.consoleErrors.length).toBe(1);
    expect(diag.consoleErrors[0]?.message).toBe('boom');
    clearPageDiagnostics(page);
    const afterClear = getPageDiagnostics(page, 5);
    expect(afterClear.consoleErrors.length).toBe(0);
  });

  it('shouldAccumulateWarnConsoleMessages', async () => {
    // R4-6: the diagnostics buffer keeps warn-level console messages (more
    // signal than error-only); the page_status title says "messages".
    const handlers: Record<string, Array<(arg: unknown) => void>> = {
      console: [],
      pageerror: [],
      requestfailed: [],
    };
    connectMock.mockResolvedValue(makeDiagnosticsBrowser(handlers));

    const {getActivePage, getPageDiagnostics} =
      await import('../src/browser.js');
    await getActivePage();
    const consoleHandler = handlers.console[0];
    expect(consoleHandler).toBeDefined();
    if (consoleHandler !== undefined) {
      consoleHandler({
        type: () => 'warn',
        text: () => 'deprecated api',
      });
    }
    const {page} = await getActivePage();
    const diag = getPageDiagnostics(page, 5);
    expect(diag.consoleErrors.length).toBe(1);
    expect(diag.consoleErrors[0]?.level).toBe('warn');
    expect(diag.consoleErrors[0]?.message).toBe('deprecated api');
  });

  it('shouldResetDiagnosticsAttachmentOnDisconnect', async () => {
    const mockBrowser = makeMockBrowser();
    connectMock.mockResolvedValue(mockBrowser);

    const handlers: Record<string, Array<(arg: unknown) => void>> = {
      console: [],
      pageerror: [],
      requestfailed: [],
    };
    const page = {
      url: () => 'https://example.com',
      on: (event: string, handler: (arg: unknown) => void) => {
        const list = handlers[event];
        if (list !== undefined) {
          list.push(handler);
        }
      },
    };
    const browserWithPages = {
      ...mockBrowser,
      pages: async () => [page],
    };
    connectMock.mockResolvedValue(browserWithPages);

    const {connectBrowser, disconnectBrowser, getActivePage} =
      await import('../src/browser.js');
    await connectBrowser();
    await getActivePage();
    expect(handlers.console.length).toBe(1);
    await disconnectBrowser();
    handlers.console.length = 0;
    // New browser + new page object (real disconnect drops the old CDP
    // connection; a fresh connect yields fresh page objects). The WeakSet
    // dedupe must attach listeners on the new object.
    const fresh = {
      url: () => 'https://example.com',
      on: (event: string, handler: (arg: unknown) => void) => {
        const list = handlers[event];
        if (list !== undefined) {
          list.push(handler);
        }
      },
    };
    connectMock.mockResolvedValue({...mockBrowser, pages: async () => [fresh]});
    await connectBrowser();
    await getActivePage();
    expect(handlers.console.length).toBe(1);
  });
});

import WebviewMessageHandler from './webview-message-handler';

describe('WebviewMessageHandler NuGet request cancellation', () => {
  it('destroys every active connection when the selected source changes', () => {
    const firstConnection = { destroy: jest.fn() };
    const redirectedConnection = { destroy: jest.fn() };
    const activeRequest = {
      cancelled: false,
      connections: new Set([firstConnection, redirectedConnection]),
    };
    const state = new Map([['request-1', activeRequest]]);
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      handleMessage(message: unknown): void;
      activeNuGetRequests: typeof state;
      workspaceState: { update: jest.Mock };
      configuredSources: [];
    };
    handler.activeNuGetRequests = state;
    handler.workspaceState = { update: jest.fn() };
    handler.configuredSources = [];

    handler.handleMessage({ command: 'select-source', sourceUrl: '' });

    expect(firstConnection.destroy).toHaveBeenCalledTimes(1);
    expect(redirectedConnection.destroy).toHaveBeenCalledTimes(1);
    expect(activeRequest.cancelled).toBe(true);
    expect(activeRequest.connections.size).toBe(0);
    expect(state.size).toBe(0);
  });

  it('marks requests without an opened connection as cancelled during DNS lookup', () => {
    const activeRequest = { cancelled: false, connections: new Set() };
    const state = new Map([['request-1', activeRequest]]);
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      handleMessage(message: unknown): void;
      activeNuGetRequests: typeof state;
      workspaceState: { update: jest.Mock };
      configuredSources: [];
    };
    handler.activeNuGetRequests = state;
    handler.workspaceState = { update: jest.fn() };
    handler.configuredSources = [];

    handler.handleMessage({ command: 'select-source', sourceUrl: '' });

    expect(activeRequest.cancelled).toBe(true);
    expect(state.size).toBe(0);
  });
});

describe('WebviewMessageHandler package operation refresh', () => {
  it('reports package changes after the project reload finishes', async () => {
    const messageOrder: string[] = [];
    const webview = {
      postMessage: jest.fn((message: { type: string }) => {
        messageOrder.push(message.type);
        return Promise.resolve(true);
      }),
    };
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      reloadProjectAfterPackageOperations(): void;
      loadProject: jest.Mock;
      webview: typeof webview;
    };
    handler.webview = webview;
    handler.loadProject = jest.fn(() =>
      Promise.resolve().then(() => {
        webview.postMessage({ type: 'project' });
      })
    );

    handler.reloadProjectAfterPackageOperations();
    await Promise.resolve();
    await Promise.resolve();

    expect(messageOrder).toEqual(['project', 'packages-changed', 'package-operation-complete']);
  });

  it('clears the operation indicator when reloading the project fails', async () => {
    const webview = { postMessage: jest.fn(() => Promise.resolve(true)) };
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      reloadProjectAfterPackageOperations(): void;
      loadProject: jest.Mock;
      webview: typeof webview;
      getErrorMessage: jest.Mock;
      log: jest.Mock;
    };
    handler.webview = webview;
    handler.loadProject = jest.fn().mockRejectedValue(new Error('reload failed'));
    handler.getErrorMessage = jest.fn(() => 'reload failed');
    handler.log = jest.fn();

    handler.reloadProjectAfterPackageOperations();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler.log).toHaveBeenCalledWith(expect.stringContaining('reload failed'));
    expect(webview.postMessage).toHaveBeenCalledWith({ type: 'package-operation-complete' });
    expect(webview.postMessage).not.toHaveBeenCalledWith({ type: 'packages-changed' });
  });
});

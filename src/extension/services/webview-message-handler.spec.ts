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

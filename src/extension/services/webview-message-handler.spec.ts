import WebviewMessageHandler from './webview-message-handler';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import * as path from 'node:path';

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

describe('WebviewMessageHandler disposal', () => {
  it('disposes the task manager with the webview handler', () => {
    const taskManager = { dispose: jest.fn() };
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), {
      taskManager,
      activeNuGetRequests: new Map(),
      disposables: [],
    }) as { dispose(): void };

    handler.dispose();

    expect(taskManager.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('WebviewMessageHandler response handling', () => {
  it('reads and decodes a response body after the response ends', async () => {
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      readResponseBody(response: IncomingMessage, request: ClientRequest, sanitizedUrl: string, startedAt: number): Promise<unknown>;
      getLoggingLevel(): string;
    };
    handler.getLoggingLevel = () => 'Information';
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      statusMessage: string;
      headers: IncomingMessage['headers'];
    };
    response.statusCode = 200;
    response.statusMessage = 'OK';
    response.headers = {};
    const result = handler.readResponseBody(
      response as IncomingMessage,
      { destroy: jest.fn() } as unknown as ClientRequest,
      'https://api.nuget.org/v3/index.json',
      Date.now()
    );

    response.emit('data', Buffer.from('{"ok":true}'));
    response.emit('end');

    await expect(result).resolves.toEqual({ statusCode: 200, statusMessage: 'OK', body: '{"ok":true}' });
  });

  it('trims a truncated multibyte response at a valid UTF-8 boundary', () => {
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      truncateResponseBody(body: string): { text: string; truncated: boolean; byteLength: number; limitKb: number };
      getDebugResponseBodyLimitKb(): number;
    };
    handler.getDebugResponseBodyLimitKb = () => 1;

    const result = handler.truncateResponseBody(`${'x'.repeat(1023)}é`);

    expect(result).toEqual({ text: 'x'.repeat(1023), truncated: true, byteLength: 1025, limitKb: 1 });
  });

  it('redacts URL credentials and sensitive query parameters', () => {
    const handler = Object.create(WebviewMessageHandler.prototype) as { sanitizeUrl(value: string): string };

    expect(handler.sanitizeUrl('https://user:password@example.test/v3?api_key=secret&page=2'))
      .toBe('https://example.test/v3?api_key=%5Bredacted%5D&page=2');
    expect(handler.sanitizeUrl('not a URL')).toBe('not a URL');
  });
});

describe('WebviewMessageHandler project target validation', () => {
  const makeHandler = (projectFilePath: string, allowedProjectPaths: string[]) => {
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      projectFilePath: string;
      solutionLoader: { readProjectPaths: jest.Mock };
      getValidatedProjectPaths(message: { projectPaths: unknown }): string[];
    };
    handler.projectFilePath = projectFilePath;
    handler.solutionLoader = { readProjectPaths: jest.fn(() => allowedProjectPaths) };
    return handler;
  };

  it('accepts only the configured project file when given a project path', () => {
    const projectFilePath = path.resolve('workspace', 'demo.csproj');
    const handler = makeHandler(projectFilePath, []);

    expect(handler.getValidatedProjectPaths({ projectPaths: [projectFilePath] })).toEqual([projectFilePath]);
    expect(handler.getValidatedProjectPaths({ projectPaths: [path.resolve('workspace', 'other.csproj')] })).toEqual([]);
  });

  it('resolves selected projects through a solution and rejects unreadable or unsupported targets', () => {
    const solutionPath = path.resolve('workspace', 'demo.sln');
    const projectPath = path.resolve('workspace', 'app', 'app.csproj');
    const handler = makeHandler(solutionPath, [projectPath]);
    expect(handler.getValidatedProjectPaths({ projectPaths: [projectPath] })).toEqual([projectPath]);
    expect(handler.solutionLoader.readProjectPaths).toHaveBeenCalledWith(solutionPath);

    const unsupported = makeHandler(path.resolve('workspace', 'readme.txt'), []);
    expect(unsupported.getValidatedProjectPaths({ projectPaths: [projectPath] })).toEqual([]);

    const unreadable = makeHandler(solutionPath, []);
    unreadable.solutionLoader.readProjectPaths.mockImplementation(() => { throw new Error('broken solution'); });
    expect(unreadable.getValidatedProjectPaths({ projectPaths: [projectPath] })).toEqual([]);
  });
});

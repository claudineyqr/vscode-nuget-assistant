import WebviewMessageHandler from './webview-message-handler';
import * as vscode from 'vscode';
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
    let finishProjectPost: (() => void) | undefined;
    const webview = {
      postMessage: jest.fn((message: { type: string }) => {
        messageOrder.push(message.type);
        if (message.type === 'project') {
          return new Promise<boolean>((resolve) => {
            finishProjectPost = () => resolve(true);
          });
        }
        return Promise.resolve(true);
      }),
    };
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      reloadProjectAfterPackageOperations(): Promise<void>;
      loadProject: jest.Mock;
      webview: typeof webview;
    };
    handler.webview = webview;
    handler.loadProject = jest.fn(async () => {
      await webview.postMessage({ type: 'project' });
    });

    const reload = handler.reloadProjectAfterPackageOperations();
    await Promise.resolve();
    expect(messageOrder).toEqual(['project']);

    finishProjectPost?.();
    await reload;

    expect(messageOrder).toEqual(['project', 'packages-changed', 'package-operation-complete']);
  });

  it('clears the operation indicator when reloading the project fails', async () => {
    const webview = { postMessage: jest.fn(() => Promise.resolve(true)) };
    const handler = Object.create(WebviewMessageHandler.prototype) as {
      reloadProjectAfterPackageOperations(): Promise<void>;
      loadProject: jest.Mock;
      webview: typeof webview;
      getErrorMessage: jest.Mock;
      log: jest.Mock;
    };
    handler.webview = webview;
    handler.loadProject = jest.fn().mockRejectedValue(new Error('reload failed'));
    handler.getErrorMessage = jest.fn(() => 'reload failed');
    handler.log = jest.fn();

    await handler.reloadProjectAfterPackageOperations();

    expect(handler.log).toHaveBeenCalledWith(expect.stringContaining('reload failed'));
    expect(webview.postMessage).toHaveBeenCalledWith({ type: 'package-operation-complete' });
    expect(webview.postMessage).not.toHaveBeenCalledWith({ type: 'packages-changed' });
  });
});

describe('WebviewMessageHandler batched package operations', () => {
  it('queues every package from one webview message before the task queue can drain', () => {
    const projectFilePath = path.resolve('workspace', 'demo.csproj');
    const taskManager = { executeTask: jest.fn() };
    const vscodeApi = vscode as unknown as { ShellQuoting?: { Strong: number } };
    const shellQuotingDescriptor = Object.getOwnPropertyDescriptor(vscodeApi, 'ShellQuoting');
    Object.defineProperty(vscodeApi, 'ShellQuoting', { configurable: true, value: { Strong: 1 } });
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), {
      configuredSources: [{ name: 'test', url: 'https://packages.example/v3/index.json' }],
      projectFilePath,
      solutionLoader: { readProjectPaths: jest.fn() },
      taskManager,
      createTask: jest.fn((command: string, args: unknown[]) => ({ command, args })),
    }) as { handleMessage(message: unknown): void };

    try {
      handler.handleMessage({
        command: 'add-packages',
        packages: [
          null,
          ...['Package1', 'Package2'].map((packageId) => ({
            command: 'add-package',
            projectName: projectFilePath,
            packageId,
            packageVersion: '1.0.0',
            packageSourceUrl: 'https://packages.example/v3/index.json',
            operation: 'update',
          })),
        ],
      });
    } finally {
      if (shellQuotingDescriptor) {
        Object.defineProperty(vscodeApi, 'ShellQuoting', shellQuotingDescriptor);
      } else {
        delete vscodeApi.ShellQuoting;
      }
    }

    expect(taskManager.executeTask).toHaveBeenCalledTimes(2);
    expect(taskManager.executeTask.mock.calls.map(([, operation]) => operation)).toEqual([
      { action: 'update', packageId: 'Package1' },
      { action: 'update', packageId: 'Package2' },
    ]);
  });

  it('ignores a batch without a package array', () => {
    const taskManager = { executeTask: jest.fn() };
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), { taskManager }) as {
      handleMessage(message: unknown): void;
    };

    handler.handleMessage({ command: 'add-packages', packages: null });

    expect(taskManager.executeTask).not.toHaveBeenCalled();
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

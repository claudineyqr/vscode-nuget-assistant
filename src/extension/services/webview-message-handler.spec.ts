import WebviewMessageHandler from './webview-message-handler';
import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import type { ClientRequest, IncomingMessage } from 'node:http';
import * as path from 'node:path';
import { ExecutionMode } from '../models/execution-mode';

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
  it('forwards package operation cancellation to the task manager', () => {
    const taskManager = { cancelTasks: jest.fn() };
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), { taskManager }) as {
      handleMessage(message: unknown): void;
    };

    handler.handleMessage({ command: 'cancel-package-operation' });

    expect(taskManager.cancelTasks).toHaveBeenCalledTimes(1);
  });

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
      getPackageExecutionMode: jest.fn(() => ExecutionMode.Dotnet),
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

  it('ignores malformed messages and unknown commands', () => {
    const taskManager = { executeTask: jest.fn(), cancelTasks: jest.fn() };
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), { taskManager }) as {
      handleMessage(message: unknown): void;
    };

    expect(() => handler.handleMessage(null)).not.toThrow();
    expect(() => handler.handleMessage({ command: 42 })).not.toThrow();
    expect(() => handler.handleMessage({ command: 'unrecognized' })).not.toThrow();
    expect(taskManager.executeTask).not.toHaveBeenCalled();
    expect(taskManager.cancelTasks).not.toHaveBeenCalled();
  });
});

describe('WebviewMessageHandler project-file package operations', () => {
  const projectPath = path.resolve('workspace', 'demo.csproj');
  const shellQuotingDescriptor = Object.getOwnPropertyDescriptor(vscode, 'ShellQuoting');
  const getConfigurationDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration');

  beforeAll(() => {
    Object.defineProperty(vscode, 'ShellQuoting', { configurable: true, value: { Strong: 1 } });
    Object.defineProperty(vscode.workspace, 'getConfiguration', {
      configurable: true,
      value: jest.fn(() => ({ get: (_key: string, defaultValue: unknown) => defaultValue })),
    });
  });

  afterAll(() => {
    if (shellQuotingDescriptor) {
      Object.defineProperty(vscode, 'ShellQuoting', shellQuotingDescriptor);
    } else {
      delete (vscode as unknown as Record<string, unknown>)['ShellQuoting'];
    }
    if (getConfigurationDescriptor) {
      Object.defineProperty(vscode.workspace, 'getConfiguration', getConfigurationDescriptor);
    } else {
      delete (vscode.workspace as unknown as Record<string, unknown>)['getConfiguration'];
    }
  });

  const makeHandler = (mode: ExecutionMode, targetPath = projectPath) => {
    const rollback = jest.fn();
    const editorApply = jest.fn(() => rollback);
    const editorApplyMany = jest.fn(() => rollback);
    const taskManager = { executeTask: jest.fn() };
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), {
      configuredSources: [{ name: 'test', url: 'https://packages.example/v3/index.json' }],
      projectFilePath: targetPath,
      solutionLoader: { readProjectPaths: jest.fn() },
      projectFileEditor: { apply: editorApply, applyMany: editorApplyMany },
      taskManager,
      getValidatedProjectPaths: jest.fn(() => [targetPath]),
      getPackageExecutionMode: jest.fn(() => mode),
      createTask: jest.fn((command: string, args: unknown[]) => ({ command, args })),
      logError: jest.fn(),
      getErrorMessage: jest.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
    }) as {
      addPackage(message: unknown): void;
      handleMessage(message: unknown): void;
      removePackage(message: unknown): void;
      projectFileEditor: { apply: jest.Mock; applyMany: jest.Mock };
      taskManager: { executeTask: jest.Mock };
      createTask: jest.Mock;
      logError: jest.Mock;
      getErrorMessage: jest.Mock;
    };
    return { handler, rollback, editorApply, editorApplyMany, taskManager };
  };

  const addMessage = {
    packageId: 'Contoso.Widget',
    packageVersion: '2.1.0',
    packageSourceUrl: 'https://packages.example/v3/index.json',
    projectName: projectPath,
  };

  it('edits the project and schedules restore for installation in project-file mode', async () => {
    const { handler, editorApply, taskManager } = makeHandler(ExecutionMode.ProjectFile);

    handler.addPackage(addMessage);
    const [prepare, operation] = taskManager.executeTask.mock.calls[0] as [() => Promise<{ task: unknown; onProcessEnd: (code: number | undefined) => void }>, unknown];
    const prepared = await prepare();
    prepared.onProcessEnd(0);

    expect(editorApply).toHaveBeenCalledWith(projectPath, 'Contoso.Widget', '2.1.0');
    expect(handler.createTask).toHaveBeenCalledWith('restore', expect.any(Array));
    expect(operation).toEqual({ action: 'install', packageId: 'Contoso.Widget' });
  });

  it('batches selected project-file updates and selectively rolls back only diagnosed packages', async () => {
    const { handler, rollback, editorApplyMany, taskManager } = makeHandler(ExecutionMode.ProjectFile);
    const errorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
    const showErrorMessage = jest.fn();
    Object.defineProperty(vscode.window, 'showErrorMessage', { configurable: true, value: showErrorMessage });

    try {
      handler.handleMessage({
        command: 'add-packages',
        packages: ['Contoso.Widget', 'Fabrikam.Utility'].map((packageId) => ({
          ...addMessage,
          packageId,
          packageVersion: '2.1.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
          operation: 'update',
        })),
      });

      expect(taskManager.executeTask).toHaveBeenCalledTimes(1);
      expect(taskManager.executeTask.mock.calls[0][1]).toEqual({
        action: 'update',
        packageId: 'Contoso.Widget',
        packageCount: 2,
      });
      const prepare = taskManager.executeTask.mock.calls[0][0] as () => Promise<{
        task: { args: Array<string | { value: string }> };
        onProcessEnd: (exitCode: number | undefined) => Promise<unknown>;
      }>;
      const firstAttempt = await prepare();
      const firstLogArgument = firstAttempt.task.args.find((arg) => typeof arg !== 'string' && arg.value.startsWith('-flp:'));
      if (!firstLogArgument || typeof firstLogArgument === 'string') {
        throw new Error('Restore file logger argument was not created.');
      }
      const firstLogPath = firstLogArgument.value.slice('-flp:logfile='.length).split(';')[0];
      fs.writeFileSync(firstLogPath, 'Demo.csproj : error NU1101: Unable to find package Contoso.Widget.');

      const retry = await firstAttempt.onProcessEnd(1) as {
        task: { args: Array<string | { value: string }> };
        onProcessEnd: (exitCode: number | undefined) => void;
      };
      expect(retry).toBeDefined();
      expect(rollback).toHaveBeenCalledTimes(1);
      expect(editorApplyMany).toHaveBeenNthCalledWith(2, projectPath, [
        { packageId: 'Fabrikam.Utility', version: '2.1.0' },
      ]);

      const retryLogArgument = retry.task.args.find((arg) => typeof arg !== 'string' && arg.value.startsWith('-flp:'));
      if (!retryLogArgument || typeof retryLogArgument === 'string') {
        throw new Error('Retry restore file logger argument was not created.');
      }
      fs.writeFileSync(retryLogArgument.value.slice('-flp:logfile='.length).split(';')[0], '');
      retry.onProcessEnd(0);

      expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Contoso.Widget'));
      expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('other selected updates were restored'));
    } finally {
      if (errorDescriptor) {
        Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
      } else {
        delete (vscode.window as unknown as Record<string, unknown>)['showErrorMessage'];
      }
    }
  });

  it('rolls the complete batch back when a selective retry also fails', async () => {
    const { handler, rollback, taskManager } = makeHandler(ExecutionMode.ProjectFile);
    const errorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
    const showErrorMessage = jest.fn();
    Object.defineProperty(vscode.window, 'showErrorMessage', { configurable: true, value: showErrorMessage });

    try {
      handler.handleMessage({
        command: 'add-packages',
        packages: ['Contoso.Widget', 'Fabrikam.Utility'].map((packageId) => ({
          ...addMessage,
          packageId,
          packageVersion: '2.1.0',
          packageSourceUrl: 'https://packages.example/v3/index.json',
          operation: 'update',
        })),
      });

      const prepare = taskManager.executeTask.mock.calls[0][0] as () => Promise<{
        task: { args: Array<string | { value: string }> };
        onProcessEnd: (exitCode: number | undefined) => Promise<unknown>;
      }>;
      const firstAttempt = await prepare();
      const firstLogArgument = firstAttempt.task.args.find((arg) => typeof arg !== 'string' && arg.value.startsWith('-flp:'));
      if (!firstLogArgument || typeof firstLogArgument === 'string') {
        throw new Error('Restore file logger argument was not created.');
      }
      fs.writeFileSync(
        firstLogArgument.value.slice('-flp:logfile='.length).split(';')[0],
        'Demo.csproj : error NU1101: Unable to find package Contoso.Widget.'
      );

      const retry = await firstAttempt.onProcessEnd(1) as {
        task: { args: Array<string | { value: string }> };
        onProcessEnd: (exitCode: number | undefined) => void;
      };
      const retryLogArgument = retry.task.args.find((arg) => typeof arg !== 'string' && arg.value.startsWith('-flp:'));
      if (!retryLogArgument || typeof retryLogArgument === 'string') {
        throw new Error('Retry restore file logger argument was not created.');
      }
      fs.writeFileSync(retryLogArgument.value.slice('-flp:logfile='.length).split(';')[0], 'error NU1301: Source unavailable.');
      retry.onProcessEnd(1);

      expect(rollback).toHaveBeenCalledTimes(2);
      expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('all project file changes were rolled back'));
    } finally {
      if (errorDescriptor) {
        Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
      } else {
        delete (vscode.window as unknown as Record<string, unknown>)['showErrorMessage'];
      }
    }
  });

  it('rolls back an installation when restore fails and reports the error', async () => {
    const { handler, rollback, taskManager } = makeHandler(ExecutionMode.ProjectFile);
    const errorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
    const showErrorMessage = jest.fn();
    Object.defineProperty(vscode.window, 'showErrorMessage', { configurable: true, value: showErrorMessage });

    try {
      handler.addPackage(addMessage);
      const [prepare] = taskManager.executeTask.mock.calls[0] as [() => Promise<{ task: unknown; onProcessEnd: (code: number | undefined) => void }>];
      const prepared = await prepare();
      prepared.onProcessEnd(1);

      expect(rollback).toHaveBeenCalledTimes(1);
      expect(showErrorMessage).toHaveBeenCalledTimes(1);
    } finally {
      if (errorDescriptor) {
        Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
      } else {
        delete (vscode.window as unknown as Record<string, unknown>)['showErrorMessage'];
      }
    }
  });

  it('logs rollback failures and still reports the restore failure', async () => {
    const { handler, rollback, taskManager } = makeHandler(ExecutionMode.ProjectFile);
    const rollbackError = new Error('rollback failed');
    rollback.mockImplementation(() => { throw rollbackError; });
    const errorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
    const showErrorMessage = jest.fn();
    Object.defineProperty(vscode.window, 'showErrorMessage', { configurable: true, value: showErrorMessage });

    try {
      handler.addPackage(addMessage);
      const [prepare] = taskManager.executeTask.mock.calls[0] as [() => Promise<{ task: unknown; onProcessEnd: (code: number | undefined) => void }>];
      const prepared = await prepare();
      prepared.onProcessEnd(1);

      expect(handler.getErrorMessage).toHaveBeenCalledWith(rollbackError);
      expect(handler.logError).toHaveBeenCalledWith(expect.stringContaining('rollback failed'));
      expect(showErrorMessage).toHaveBeenCalledTimes(1);
    } finally {
      if (errorDescriptor) {
        Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
      } else {
        delete (vscode.window as unknown as Record<string, unknown>)['showErrorMessage'];
      }
    }
  });

  it('rolls back a cancelled removal without showing a restore error', async () => {
    const { handler, rollback, editorApply, taskManager } = makeHandler(ExecutionMode.ProjectFile);
    const errorDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'showErrorMessage');
    const showErrorMessage = jest.fn();
    Object.defineProperty(vscode.window, 'showErrorMessage', { configurable: true, value: showErrorMessage });

    try {
      handler.removePackage({ packageId: 'Contoso.Widget', projectName: projectPath });
      const [prepare, operation] = taskManager.executeTask.mock.calls[0] as [() => Promise<{ task: unknown; onProcessEnd: (code: number | undefined) => void }>, unknown];
      const prepared = await prepare();
      prepared.onProcessEnd(undefined);

      expect(editorApply).toHaveBeenCalledWith(projectPath, 'Contoso.Widget', undefined);
      expect(operation).toEqual({ action: 'remove', packageId: 'Contoso.Widget' });
      expect(rollback).toHaveBeenCalledTimes(1);
      expect(showErrorMessage).not.toHaveBeenCalled();
    } finally {
      if (errorDescriptor) {
        Object.defineProperty(vscode.window, 'showErrorMessage', errorDescriptor);
      } else {
        delete (vscode.window as unknown as Record<string, unknown>)['showErrorMessage'];
      }
    }
  });

  it('keeps using dotnet commands when project-file mode is not selected', () => {
    const { handler, taskManager } = makeHandler(ExecutionMode.Dotnet);

    handler.addPackage(addMessage);

    const args = handler.createTask.mock.calls[0][1] as Array<string | { value: string }>;
    expect(args.map((arg) => typeof arg === 'string' ? arg : arg.value)).toEqual(expect.arrayContaining(['add', 'package', 'Contoso.Widget']));
    expect(taskManager.executeTask.mock.calls[0][1]).toEqual({ action: 'install', packageId: 'Contoso.Widget' });
  });

  it('routes a removal message to dotnet with the selected package and project', () => {
    const { handler, taskManager } = makeHandler(ExecutionMode.Dotnet);

    handler.handleMessage({ command: 'remove-package', packageId: 'Contoso.Widget', projectName: projectPath });

    expect(handler.createTask).toHaveBeenCalledWith('remove', expect.arrayContaining([
      'remove', expect.objectContaining({ value: projectPath }), 'package', expect.objectContaining({ value: 'Contoso.Widget' }),
    ]));
    expect(taskManager.executeTask).toHaveBeenCalledWith(
      expect.anything(),
      { action: 'remove', packageId: 'Contoso.Widget' }
    );
  });

  it.each([
    ['invalid package identifier', { ...addMessage, packageId: '../Contoso.Widget' }],
    ['unconfigured source', { ...addMessage, packageSourceUrl: 'https://other.example/v3/index.json' }],
    ['invalid package version', { ...addMessage, packageVersion: 'not a version' }],
  ])('does not schedule an add for %s', (_caseName, message) => {
    const { handler, taskManager } = makeHandler(ExecutionMode.Dotnet);

    handler.handleMessage({ command: 'add-package', ...message });

    expect(taskManager.executeTask).not.toHaveBeenCalled();
  });

  it('uses dotnet when project-file mode targets a non-csproj file', () => {
    const vbProjectPath = path.resolve('workspace', 'demo.vbproj');
    const { handler } = makeHandler(ExecutionMode.ProjectFile, vbProjectPath);

    handler.addPackage({ ...addMessage, projectName: vbProjectPath });

    expect(handler.createTask).toHaveBeenCalledWith('add', expect.any(Array));
  });

  it('falls back to project-file mode for an invalid configured execution mode', () => {
    const getConfigurationDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration');
    Object.defineProperty(vscode.workspace, 'getConfiguration', {
      configurable: true,
      value: jest.fn(() => ({ get: () => 'invalid-mode' })),
    });
    const handler = Object.create(WebviewMessageHandler.prototype) as { getPackageExecutionMode(): ExecutionMode };

    try {
      expect(handler.getPackageExecutionMode()).toBe(ExecutionMode.ProjectFile);
    } finally {
      if (getConfigurationDescriptor) {
        Object.defineProperty(vscode.workspace, 'getConfiguration', getConfigurationDescriptor);
      }
    }
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

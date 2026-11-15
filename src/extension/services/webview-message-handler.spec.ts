jest.mock('node:dns', () => {
  const actual = jest.requireActual('node:dns');
  return { ...actual, promises: { ...actual.promises, lookup: jest.fn() } };
});
jest.mock('node:http', () => ({ ...jest.requireActual('node:http'), request: jest.fn() }));
jest.mock('node:https', () => ({ ...jest.requireActual('node:https'), request: jest.fn() }));

import WebviewMessageHandler from './webview-message-handler';
import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';
import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import * as path from 'node:path';
import NuGetConfigLoader from './nuget-config-loader';
import ProjectFileLoader from './project-file-loader';
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

describe('WebviewMessageHandler package source configuration', () => {
  const sourceUrl = 'https://packages.example/v3/index.json';
  const makeHandler = (sources: unknown[], preferredSource: unknown) => {
    const webview = { postMessage: jest.fn() };
    const workspaceState = { get: jest.fn(() => preferredSource), update: jest.fn() };
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), {
      projectFilePath: path.resolve('workspace', 'demo.csproj'),
      configuredSources: [],
      nuGetConfigLoader: { loadAsync: jest.fn().mockResolvedValue(sources) },
      workspaceState,
      webview,
      log: jest.fn(),
      logHandledError: jest.fn(),
      getErrorMessage: jest.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
    }) as {
      loadConfiguration(): void;
      saveSelectedSource(sourceUrl: unknown): Promise<void>;
      configuredSources: Array<{ name: string; url: string; authorizationHeader?: string }>;
      nuGetConfigLoader: { loadAsync: jest.Mock };
      workspaceState: typeof workspaceState;
      webview: typeof webview;
      logHandledError: jest.Mock;
      getErrorMessage: jest.Mock;
    };
    return { handler, webview, workspaceState };
  };

  it('sends only safe feeds to the webview and removes credentials from public source data', async () => {
    const { handler, webview } = makeHandler([
      { name: 'Private', url: sourceUrl, authorizationHeader: 'Basic secret' },
      { name: 'Unsupported', url: 'file:///packages' },
    ], sourceUrl);

    handler.loadConfiguration();
    await Promise.resolve();

    expect(handler.configuredSources).toHaveLength(1);
    expect(handler.configuredSources[0].authorizationHeader).toBe('Basic secret');
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: 'sources',
      data: [{ name: 'Private', url: sourceUrl, authorizationHeader: undefined }],
      selectedSourceUrl: sourceUrl,
    });
  });

  it('clears a remembered source that is no longer configured', async () => {
    const { handler, webview, workspaceState } = makeHandler([
      { name: 'Public', url: sourceUrl, authorizationHeader: undefined },
    ], 'https://removed.example/v3/index.json');

    handler.loadConfiguration();
    await Promise.resolve();

    expect(workspaceState.update).toHaveBeenCalledWith('nuget-assistant.selectedSourceUrl', '');
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ selectedSourceUrl: '' }));
  });

  it('persists only an empty source selection or a configured feed URL', async () => {
    const { handler, workspaceState } = makeHandler([
      { name: 'Private', url: sourceUrl, authorizationHeader: undefined },
    ], undefined);
    handler.configuredSources = [{ name: 'Private', url: sourceUrl, authorizationHeader: undefined }];

    await handler.saveSelectedSource(sourceUrl);
    await handler.saveSelectedSource('');
    await handler.saveSelectedSource('https://unknown.example/index.json');
    await handler.saveSelectedSource(42);
    await handler.saveSelectedSource('x'.repeat(2049));

    expect(workspaceState.update).toHaveBeenCalledTimes(2);
    expect(workspaceState.update).toHaveBeenNthCalledWith(1, 'nuget-assistant.selectedSourceUrl', sourceUrl);
    expect(workspaceState.update).toHaveBeenNthCalledWith(2, 'nuget-assistant.selectedSourceUrl', '');
  });

  it('reports NuGet configuration load failures', async () => {
    const { handler } = makeHandler([], undefined);
    const error = new Error('invalid config');
    handler.nuGetConfigLoader.loadAsync.mockRejectedValue(error);
    const showError = jest.spyOn(vscode.window, 'showErrorMessage');

    handler.loadConfiguration();
    await Promise.resolve();

    expect(handler.logHandledError).toHaveBeenCalledWith(expect.stringContaining('invalid config'), error);
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('invalid config'));
  });
});

describe('WebviewMessageHandler startup flow', () => {
  it('loads the opened project and package feeds, then reloads feeds on configuration changes', async () => {
    const descriptors = [
      [vscode.workspace, 'getConfiguration'],
      [vscode.workspace, 'onDidChangeConfiguration'],
      [vscode.tasks, 'onDidEndTask'],
    ] as const;
    const originals = descriptors.map(([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)] as const);
    let receiveMessage: ((message: unknown) => void) | undefined;
    let configurationChanged: (() => void) | undefined;
    const webview = {
      postMessage: jest.fn().mockResolvedValue(true),
      onDidReceiveMessage: jest.fn((callback: (message: unknown) => void) => { receiveMessage = callback; }),
    };
    const source = { name: 'Private', url: 'https://packages.example/v3/index.json', authorizationHeader: 'Basic secret' };
    const project = { name: 'Demo.csproj', fsPath: path.resolve('workspace', 'Demo.csproj'), packages: [] };
    const loadProject = jest.spyOn(ProjectFileLoader.prototype, 'loadProjectAsync').mockResolvedValue(project);
    const loadSources = jest.spyOn(NuGetConfigLoader.prototype, 'loadAsync').mockResolvedValue([source]);

    Object.defineProperty(vscode.workspace, 'getConfiguration', {
      configurable: true,
      value: jest.fn(() => ({ get: (_key: string, fallback: unknown) => fallback })),
    });
    Object.defineProperty(vscode.workspace, 'onDidChangeConfiguration', {
      configurable: true,
      value: jest.fn((callback: () => void) => {
        configurationChanged = callback;
        return { dispose: jest.fn() };
      }),
    });
    Object.defineProperty(vscode.tasks, 'onDidEndTask', {
      configurable: true,
      value: jest.fn(() => ({ dispose: jest.fn() })),
    });

    try {
      const handler = new WebviewMessageHandler(
        webview as never,
        project.fsPath,
        { appendLine: jest.fn() } as never,
        { get: jest.fn(() => undefined), update: jest.fn() } as never
      );

      expect(webview.onDidReceiveMessage).toHaveBeenCalledTimes(1);
      receiveMessage?.({ command: 'load-project' });
      await Promise.resolve();
      await Promise.resolve();

      expect(loadProject).toHaveBeenCalledWith(project.fsPath);
      expect(loadSources).toHaveBeenCalledTimes(1);
      expect(webview.postMessage).toHaveBeenCalledWith({ type: 'project', data: project });
      expect(webview.postMessage).toHaveBeenCalledWith({
        type: 'sources',
        data: [{ ...source, authorizationHeader: undefined }],
        selectedSourceUrl: undefined,
      });

      configurationChanged?.();
      await Promise.resolve();

      expect(loadSources).toHaveBeenCalledTimes(2);
      handler.dispose();
    } finally {
      loadProject.mockRestore();
      loadSources.mockRestore();
      for (const [target, key, descriptor] of originals) {
        if (descriptor) {
          Object.defineProperty(target, key, descriptor);
        } else {
          Reflect.deleteProperty(target, key);
        }
      }
    }
  });
});

describe('WebviewMessageHandler NuGet HTTP message flow', () => {
  const sourceUrl = 'https://packages.example/v3/index.json';
  const requestUrl = 'https://packages.example/query?q=Contoso';
  const makeHandler = (requestResult: Promise<unknown>) => {
    const webview = { postMessage: jest.fn() };
    const requestText = jest.fn(() => requestResult);
    const activeNuGetRequests = new Map();
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), {
      configuredSources: [{ name: 'Private', url: sourceUrl, authorizationHeader: 'Basic secret' }],
      activeNuGetRequests,
      webview,
      requestText,
      sanitizeUrl: jest.fn((url: string) => url),
      logHttpResponse: jest.fn(),
      getErrorMessage: jest.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
      logError: jest.fn(),
    }) as {
      handleNuGetHttpRequest(message: unknown): Promise<void>;
      activeNuGetRequests: Map<string, { cancelled: boolean; connections: Set<unknown> }>;
      requestText: jest.Mock;
      webview: typeof webview;
      sanitizeUrl: jest.Mock;
      logHttpResponse: jest.Mock;
      logError: jest.Mock;
    };
    return { handler, requestText, webview };
  };

  const requestMessage = {
    requestId: 'request-1',
    url: requestUrl,
    sourceUrl,
    headers: { accept: 'application/json' },
  };

  it('sends valid requests through the configured feed and returns the response', async () => {
    const result = { statusCode: 200, statusMessage: 'OK', body: '{"ok":true}' };
    const { handler, requestText, webview } = makeHandler(Promise.resolve(result));

    await handler.handleNuGetHttpRequest(requestMessage);

    expect(requestText).toHaveBeenCalledWith(
      new URL(requestUrl),
      new URL(sourceUrl),
      requestMessage.headers,
      expect.objectContaining({ cancelled: false }),
      expect.objectContaining({ authorizationHeader: 'Basic secret', authorizationAllowed: true })
    );
    expect(webview.postMessage).toHaveBeenCalledWith({ type: 'nuget-http-response', requestId: 'request-1', ...result });
    expect(handler.activeNuGetRequests.size).toBe(0);
  });

  it('rejects a request for an unconfigured feed without making a network request', async () => {
    const { handler, requestText, webview } = makeHandler(Promise.resolve({ statusCode: 200, body: '' }));

    await handler.handleNuGetHttpRequest({ ...requestMessage, sourceUrl: 'https://unknown.example/index.json' });

    expect(requestText).not.toHaveBeenCalled();
    expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'nuget-http-response', requestId: 'request-1', statusCode: 0,
    }));
  });

  it('returns request failures to the webview and clears request state', async () => {
    const { handler, webview } = makeHandler(Promise.reject(new Error('connection refused')));

    await handler.handleNuGetHttpRequest(requestMessage);

    expect(webview.postMessage).toHaveBeenCalledWith({
      type: 'nuget-http-response', requestId: 'request-1', statusCode: 0, error: 'connection refused',
    });
    expect(handler.activeNuGetRequests.size).toBe(0);
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

describe('WebviewMessageHandler NuGet transport security', () => {
  const getConfigurationDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration');
  const dnsLookup = dns.promises.lookup as jest.Mock;
  const httpRequest = http.request as unknown as jest.Mock;
  const httpsRequest = https.request as unknown as jest.Mock;

  const makeHandler = () => Object.assign(Object.create(WebviewMessageHandler.prototype), {
    logHttpDebug: jest.fn(),
    sanitizeUrl: jest.fn((value: string) => value),
    getLoggingLevel: jest.fn(() => 'None'),
    getDebugResponseBodyLimitKb: jest.fn(() => 32),
  }) as {
    requestText(
      url: URL,
      sourceUrl: URL,
      headers: Record<string, string>,
      activeRequest: { cancelled: boolean; connections: Set<unknown> },
      context: { authorizationHeader?: string; redirects: number; originalOrigin: string; authorizationAllowed: boolean }
    ): Promise<{ statusCode: number; statusMessage?: string; body: string }>;
    logHttpDebug: jest.Mock;
  };

  beforeEach(() => {
    dnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    httpRequest.mockReset();
    httpsRequest.mockReset();
    Object.defineProperty(vscode.workspace, 'getConfiguration', {
      configurable: true,
      value: jest.fn(() => ({ get: (_key: string, fallback: unknown) => fallback })),
    });
  });

  afterAll(() => {
    if (getConfigurationDescriptor) {
      Object.defineProperty(vscode.workspace, 'getConfiguration', getConfigurationDescriptor);
    } else {
      delete (vscode.workspace as unknown as Record<string, unknown>)['getConfiguration'];
    }
  });

  it('blocks credentialed HTTP requests before DNS or transport access by default', async () => {
    const handler = makeHandler();
    const activeRequest = { cancelled: false, connections: new Set() };

    await expect(handler.requestText(
      new URL('http://packages.example/query'),
      new URL('http://packages.example/index.json'),
      {},
      activeRequest,
      { authorizationHeader: 'Basic secret', redirects: 0, originalOrigin: 'http://packages.example', authorizationAllowed: true }
    )).rejects.toThrow('HTTP requests with NuGet source credentials are disabled');

    expect(dnsLookup).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('rejects a NuGet service URL that resolves to a private address', async () => {
    const handler = makeHandler();
    dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(handler.requestText(
      new URL('https://metadata.example.test/service-index.json'),
      new URL('https://packages.example/v3/index.json'),
      {},
      { cancelled: false, connections: new Set() },
      { redirects: 0, originalOrigin: 'https://metadata.example.test', authorizationAllowed: false }
    )).rejects.toThrow('local or private network address');

    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('stops cancelled requests and redirect chains beyond the allowed limit', async () => {
    const handler = makeHandler();
    const url = new URL('https://packages.example/query');
    const sourceUrl = new URL('https://packages.example/index.json');

    await expect(handler.requestText(
      url,
      sourceUrl,
      {},
      { cancelled: true, connections: new Set() },
      { redirects: 0, originalOrigin: url.origin, authorizationAllowed: true }
    )).rejects.toThrow('request cancelled');
    await expect(handler.requestText(
      url,
      sourceUrl,
      {},
      { cancelled: false, connections: new Set() },
      { redirects: 6, originalOrigin: url.origin, authorizationAllowed: true }
    )).rejects.toThrow('Too many redirects');

    expect(dnsLookup).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('drops source authorization after a redirect to another origin', async () => {
    const handler = makeHandler();
    const activeRequest = { cancelled: false, connections: new Set() };
    const responses: Array<{ statusCode: number; statusMessage: string; headers: Record<string, string>; body: string }> = [
      { statusCode: 302, statusMessage: 'Found', headers: { location: 'https://cdn.example.test/package.json' }, body: '' },
      { statusCode: 200, statusMessage: 'OK', headers: {}, body: '{"versions":[]}' },
    ];
    httpsRequest.mockImplementation((_url, options, callback) => {
      const request = new EventEmitter() as EventEmitter & { end: jest.Mock; destroy: jest.Mock };
      request.destroy = jest.fn();
      request.end = jest.fn(() => {
        const responseData = responses.shift();
        if (!responseData) {
          throw new Error('Unexpected HTTPS request');
        }
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          statusMessage: string;
          headers: Record<string, string>;
          resume: jest.Mock;
        };
        response.statusCode = responseData.statusCode;
        response.statusMessage = responseData.statusMessage;
        response.headers = responseData.headers;
        response.resume = jest.fn();
        callback(response);
        if (responseData.statusCode === 200) {
          response.emit('data', Buffer.from(responseData.body));
          response.emit('end');
        }
        request.emit('close');
      });
      expect(options.headers).toEqual(expect.objectContaining({ 'accept-encoding': 'gzip' }));
      return request;
    });

    const response = await handler.requestText(
      new URL('https://packages.example/query'),
      new URL('https://packages.example/index.json'),
      { accept: 'application/json', authorization: 'webview supplied value', 'x-ignore': 'value' },
      activeRequest,
      { authorizationHeader: 'Basic configured-secret', redirects: 0, originalOrigin: 'https://packages.example', authorizationAllowed: true }
    );

    expect(response).toEqual({ statusCode: 200, statusMessage: 'OK', body: '{"versions":[]}' });
    expect(httpsRequest).toHaveBeenCalledTimes(2);
    expect((httpsRequest.mock.calls[0][1] as { headers: Record<string, string> }).headers).toEqual({
      accept: 'application/json', 'accept-encoding': 'gzip', authorization: 'Basic configured-secret',
    });
    expect((httpsRequest.mock.calls[1][1] as { headers: Record<string, string> }).headers).toEqual({
      accept: 'application/json', 'accept-encoding': 'gzip',
    });
    expect(dnsLookup).toHaveBeenCalledTimes(2);
    expect(activeRequest.connections.size).toBe(0);
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

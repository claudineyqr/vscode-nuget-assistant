jest.mock('./services/nuget-config-message-handler', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ dispose: jest.fn() })),
}));
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  readFileSync: jest.fn(),
}));

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import ConfigPanel from './config-panel';
import NuGetConfigMessageHandler from './services/nuget-config-message-handler';

describe('ConfigPanel', () => {
  const descriptors: Array<[object, string, PropertyDescriptor | undefined]> = [];
  const defineMock = (target: object, key: string, value: unknown) => {
    descriptors.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
  };

  let panelDisposed: (() => void) | undefined;
  let webviewPanel: {
    webview: { html: string; cspSource: string; asWebviewUri: jest.Mock; onDidReceiveMessage: jest.Mock };
    reveal: jest.Mock;
    dispose: jest.Mock;
    onDidDispose: jest.Mock;
    iconPath?: unknown;
  };
  let createWebviewPanel: jest.Mock;
  const readFile = fs.readFileSync as jest.Mock;

  beforeEach(() => {
    descriptors.length = 0;
    panelDisposed = undefined;
    ConfigPanel.currentPanel = undefined;
    jest.clearAllMocks();

    webviewPanel = {
      webview: {
        html: '',
        cspSource: 'vscode-webview://resource',
        asWebviewUri: jest.fn(() => ({ toString: () => 'vscode-webview://app/dist' })),
        onDidReceiveMessage: jest.fn(),
      },
      reveal: jest.fn(),
      dispose: jest.fn(),
      onDidDispose: jest.fn((callback: () => void, _thisArg: unknown, disposables: vscode.Disposable[]) => {
        panelDisposed = callback;
        disposables.push({ dispose: jest.fn() });
        return { dispose: jest.fn() };
      }),
    };
    createWebviewPanel = jest.fn(() => webviewPanel);

    defineMock(vscode.window, 'createWebviewPanel', createWebviewPanel);
    defineMock(vscode.window, 'activeTextEditor', { viewColumn: 2 });
    defineMock(vscode.workspace, 'getConfiguration', jest.fn(() => ({ get: () => 'pt-BR' })));
    defineMock(vscode, 'env', { language: 'en-US' });

    readFile.mockReset().mockReturnValue('<html lang="en"><head></head><body><base href="/"></body></html>');
  });

  afterEach(() => {
    for (const [target, key, descriptor] of descriptors.reverse()) {
      if (descriptor) {
        Object.defineProperty(target, key, descriptor);
      } else {
        Reflect.deleteProperty(target, key);
      }
    }
    ConfigPanel.currentPanel = undefined;
    jest.restoreAllMocks();
  });

  it('opens a single titled tab with the configurations view marker', () => {
    ConfigPanel.createOrShow('/extension', {} as vscode.OutputChannel);

    expect(createWebviewPanel).toHaveBeenCalledWith(
      'nuget-assistant-configurations',
      'Nuget Assistant: Configurations',
      2,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [expect.objectContaining({ fsPath: path.join('/extension', 'dist') })],
      })
    );
    expect(webviewPanel.iconPath).toEqual(expect.objectContaining({ fsPath: path.join('/extension', 'images', 'logo.png') }));
    expect(webviewPanel.webview.html).toContain('<meta name="nuget-assistant-route" content="configurations">');
    expect(webviewPanel.webview.html).toContain('<html lang="pt-BR">');
    expect(webviewPanel.webview.html).toContain("connect-src 'none'");
  });

  it('creates the handler without any project path and reuses the single panel', () => {
    ConfigPanel.createOrShow('/extension', {} as vscode.OutputChannel);
    const handlerConstructor = jest.mocked(NuGetConfigMessageHandler);
    const handler = handlerConstructor.mock.results[0].value as { dispose: jest.Mock };

    const panel = ConfigPanel.createOrShow('/extension', {} as vscode.OutputChannel);

    expect(handlerConstructor.mock.calls[0]).toHaveLength(2);
    expect(panel).toBe(ConfigPanel.currentPanel);
    expect(createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(webviewPanel.reveal).toHaveBeenCalledWith(2);

    panelDisposed?.();

    expect(handler.dispose).toHaveBeenCalledTimes(1);
    expect(webviewPanel.dispose).toHaveBeenCalledTimes(1);
    expect(ConfigPanel.currentPanel).toBeUndefined();
  });

  it('reloads the open configuration tab when the language changes', () => {
    ConfigPanel.createOrShow('/extension', {} as vscode.OutputChannel);
    readFile.mockClear();

    ConfigPanel.reloadAllForLanguageChange();

    expect(readFile).toHaveBeenCalledTimes(1);
  });
});

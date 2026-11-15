jest.mock('./services/webview-message-handler', () => ({
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
import WebviewMessageHandler from './services/webview-message-handler';
import UiPanel from './ui-panel';

describe('UiPanel', () => {
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
  let webview: { html: string; cspSource: string; asWebviewUri: jest.Mock; onDidReceiveMessage: jest.Mock };
  let createWebviewPanel: jest.Mock;
  const readFile = fs.readFileSync as jest.Mock;

  beforeEach(() => {
    descriptors.length = 0;
    panelDisposed = undefined;
    Object.keys(UiPanel.currentPanels).forEach((key) => delete UiPanel.currentPanels[key]);
    jest.clearAllMocks();

    webview = {
      html: '',
      cspSource: 'vscode-webview://resource',
      asWebviewUri: jest.fn(() => ({ toString: () => 'vscode-webview://app/dist' })),
      onDidReceiveMessage: jest.fn(),
    };
    webviewPanel = {
      webview,
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
    Object.keys(UiPanel.currentPanels).forEach((key) => delete UiPanel.currentPanels[key]);
    jest.restoreAllMocks();
  });

  it('creates a localized webview with a restrictive content security policy', () => {
    const project = { fsPath: '/repo/App.csproj' } as vscode.Uri;

    UiPanel.createOrShow('/extension', project, {} as vscode.OutputChannel, {} as vscode.Memento);

    expect(createWebviewPanel).toHaveBeenCalledWith('angular', 'NuGet Assistant: App.csproj', 2, expect.objectContaining({
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [expect.objectContaining({ fsPath: path.join('/extension', 'dist') })],
    }));
    expect(webviewPanel.iconPath).toEqual(expect.objectContaining({ fsPath: path.join('/extension', 'images', 'logo.png') }));
    expect(webview.html).toContain('<html lang="pt-BR">');
    expect(webview.html).toContain('<meta name="nuget-assistant-locale" content="pt-BR">');
    expect(webview.html).toContain("default-src 'none'");
    expect(webview.html).toContain("connect-src 'none'");
    expect(webview.html).toContain('vscode-webview://app/dist/');
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining('dist'), { encoding: 'utf8' });
  });

  it('reveals an existing panel for the same project and disposes its handler when closed', () => {
    const project = { fsPath: '/repo/App.csproj' } as vscode.Uri;
    const outputChannel = {} as vscode.OutputChannel;
    const workspaceState = {} as vscode.Memento;

    const panels = UiPanel.createOrShow('/extension', project, outputChannel, workspaceState);
    const handler = jest.mocked(WebviewMessageHandler).mock.results[0].value as { dispose: jest.Mock };
    const reusedPanels = UiPanel.createOrShow('/extension', project, outputChannel, workspaceState);

    expect(reusedPanels).toBe(panels);
    expect(createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(webviewPanel.reveal).toHaveBeenCalledWith(2);

    panelDisposed?.();

    expect(handler.dispose).toHaveBeenCalledTimes(1);
    expect(webviewPanel.dispose).toHaveBeenCalledTimes(1);
    expect(UiPanel.currentPanels[project.fsPath]).toBeUndefined();
  });

  it('reloads all open panels when the language changes', () => {
    UiPanel.createOrShow('/extension', { fsPath: '/repo/First.csproj' } as vscode.Uri, {} as vscode.OutputChannel, {} as vscode.Memento);
    UiPanel.createOrShow('/extension', { fsPath: '/repo/Second.csproj' } as vscode.Uri, {} as vscode.OutputChannel, {} as vscode.Memento);
    readFile.mockClear();

    UiPanel.reloadAllForLanguageChange();

    expect(readFile).toHaveBeenCalledTimes(2);
  });
});

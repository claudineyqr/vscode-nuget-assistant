jest.mock('./nuget-config-editor', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    loadAsync: jest.fn(),
    saveAsync: jest.fn(),
  })),
}));

import * as vscode from 'vscode';
import NuGetConfigEditor from './nuget-config-editor';
import NuGetConfigMessageHandler from './nuget-config-message-handler';

describe('NuGetConfigMessageHandler', () => {
  let webview: { postMessage: jest.Mock; onDidReceiveMessage: jest.Mock };
  let outputChannel: { appendLine: jest.Mock };
  let handler: NuGetConfigMessageHandler;
  let receiveMessage: ((message: unknown) => void) | undefined;
  let editor: { loadAsync: jest.Mock; saveAsync: jest.Mock };
  let originalGetConfiguration: PropertyDescriptor | undefined;

  const snapshot = { files: [], selectedFilePath: 'C:\\NuGet.Config', fileExists: true, sources: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    originalGetConfiguration = Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration');
    Object.defineProperty(vscode.workspace, 'getConfiguration', {
      configurable: true,
      value: jest.fn(() => ({ get: () => 'Error' })),
    });
    webview = {
      postMessage: jest.fn(),
      onDidReceiveMessage: jest.fn((callback: (message: unknown) => void) => {
        receiveMessage = callback;
      }),
    };
    outputChannel = { appendLine: jest.fn() };
    handler = new NuGetConfigMessageHandler(
      webview as never,
      outputChannel as never
    );
    editor = jest.mocked(NuGetConfigEditor).mock.results[0].value as {
      loadAsync: jest.Mock;
      saveAsync: jest.Mock;
    };
  });

  afterEach(() => {
    handler.dispose();
    if (originalGetConfiguration) {
      Object.defineProperty(vscode.workspace, 'getConfiguration', originalGetConfiguration);
    } else {
      Reflect.deleteProperty(vscode.workspace, 'getConfiguration');
    }
  });

  it('loads the configuration and posts the snapshot', async () => {
    editor.loadAsync.mockResolvedValue(snapshot);

    receiveMessage?.({ command: 'load-nuget-config' });
    await Promise.resolve();

    expect(editor.loadAsync).toHaveBeenCalledWith(undefined, undefined);
    expect(webview.postMessage).toHaveBeenCalledWith({ type: 'nuget-config', data: snapshot });
  });

  it('forwards the requested configuration file when loading', async () => {
    editor.loadAsync.mockResolvedValue(snapshot);

    receiveMessage?.({ command: 'load-nuget-config', filePath: 'C:\\repo\\NuGet.Config' });
    await Promise.resolve();

    expect(editor.loadAsync).toHaveBeenCalledWith(undefined, 'C:\\repo\\NuGet.Config');
  });

  it('saves the configuration and posts the updated snapshot', async () => {
    const sources = [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true }];
    editor.saveAsync.mockResolvedValue(snapshot);

    receiveMessage?.({ command: 'save-nuget-config', filePath: 'C:\\NuGet.Config', sources });
    await Promise.resolve();

    expect(editor.saveAsync).toHaveBeenCalledWith(undefined, 'C:\\NuGet.Config', sources);
    expect(webview.postMessage).toHaveBeenCalledWith({ type: 'nuget-config-saved', data: snapshot });
  });

  it('reports load and save errors to the page and the output channel', async () => {
    editor.loadAsync.mockRejectedValue(new Error('bad xml'));
    editor.saveAsync.mockRejectedValue(new Error('invalid source'));

    receiveMessage?.({ command: 'load-nuget-config' });
    receiveMessage?.({ command: 'save-nuget-config', filePath: 'C:\\NuGet.Config', sources: [] });
    await Promise.resolve();
    await Promise.resolve();

    const errors = webview.postMessage.mock.calls
      .filter(([message]) => (message as { type?: string }).type === 'nuget-config-error')
      .map(([message]) => (message as { error: string }).error);
    expect(errors).toEqual(['bad xml', 'invalid source']);
    expect(outputChannel.appendLine).toHaveBeenCalledTimes(2);
  });

  it('ignores unknown commands and malformed messages', () => {
    receiveMessage?.({ command: 'unknown-command' });
    receiveMessage?.('not a message');

    expect(editor.loadAsync).not.toHaveBeenCalled();
    expect(editor.saveAsync).not.toHaveBeenCalled();
    expect(webview.postMessage).not.toHaveBeenCalled();
  });
});

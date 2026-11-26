import * as vscode from 'vscode';
import { formatErrorMessage } from '../../shared/utils/error-message';
import NuGetConfigEditor from './nuget-config-editor';
import { isRecord } from './security-validation';

export default class NuGetConfigMessageHandler {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly editor: NuGetConfigEditor;

  public constructor(
    private readonly webview: vscode.Webview,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    this.editor = new NuGetConfigEditor();
    this.webview.onDidReceiveMessage(
      (message: unknown) => this.handleMessage(message),
      null,
      this.disposables
    );
  }

  public dispose(): void {
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message) || typeof message['command'] !== 'string') {
      return;
    }
    switch (message['command']) {
      case 'load-nuget-config':
        this.load(message['filePath']);
        return;
      case 'save-nuget-config':
        this.save(message);
        return;
    }
  }

  private load(filePath: unknown): void {
    const requestedPath = typeof filePath === 'string' && filePath.length > 0 ? filePath : undefined;
    void this.editor.loadAsync(undefined, requestedPath)
      .then((snapshot) => this.webview.postMessage({ type: 'nuget-config', data: snapshot }))
      .catch((error) => this.reportError('Error loading the NuGet configuration', error));
  }

  private save(message: Record<string, unknown>): void {
    void this.editor.saveAsync(undefined, message['filePath'], message['sources'])
      .then((snapshot) => this.webview.postMessage({ type: 'nuget-config-saved', data: snapshot }))
      .catch((error) => this.reportError('Error saving the NuGet configuration', error));
  }

  private reportError(action: string, error: unknown): void {
    const details = formatErrorMessage(error);
    const level = vscode.workspace
      .getConfiguration?.('nuget-assistant')
      ?.get<string>('loggingLevel', 'None') ?? 'None';
    if (level !== 'None') {
      this.outputChannel.appendLine(`[${new Date().toISOString()}] ${action}: ${details}`);
    }
    this.webview.postMessage({ type: 'nuget-config-error', error: details });
  }
}

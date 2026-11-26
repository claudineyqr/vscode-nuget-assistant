import * as path from 'node:path';
import * as vscode from 'vscode';
import NuGetConfigMessageHandler from './services/nuget-config-message-handler';
import { getWebviewHtml } from './webview-html';

export default class ConfigPanel {
  public static currentPanel: ConfigPanel | undefined = undefined;

  private static readonly viewType = 'nuget-assistant-configurations';
  private static readonly title = 'Nuget Assistant: Configurations';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionPath: string;
  private readonly handler: NuGetConfigMessageHandler;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionPath: string, outputChannel: vscode.OutputChannel): ConfigPanel | undefined {
    if (ConfigPanel.currentPanel) {
      ConfigPanel.currentPanel.panel.reveal(vscode.window.activeTextEditor?.viewColumn);
      return ConfigPanel.currentPanel;
    }

    ConfigPanel.currentPanel = new ConfigPanel(
      extensionPath,
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One,
      outputChannel
    );
    return ConfigPanel.currentPanel;
  }

  public static reloadAllForLanguageChange(): void {
    ConfigPanel.currentPanel?.reloadForLanguageChange();
  }

  private constructor(
    extensionPath: string,
    column: vscode.ViewColumn,
    outputChannel: vscode.OutputChannel
  ) {
    this.extensionPath = extensionPath;

    this.panel = vscode.window.createWebviewPanel(ConfigPanel.viewType, ConfigPanel.title, column, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, 'dist'))],
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.file(path.join(this.extensionPath, 'images', 'logo.png'));
    this.handler = new NuGetConfigMessageHandler(this.panel.webview, outputChannel);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.html = this.getHtmlForWebview();
  }

  private dispose(): void {
    ConfigPanel.currentPanel = undefined;
    this.handler.dispose();
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private getHtmlForWebview(): string {
    return getWebviewHtml(this.extensionPath, this.panel.webview, 'configurations');
  }

  private reloadForLanguageChange(): void {
    this.panel.webview.html = this.getHtmlForWebview();
  }
}

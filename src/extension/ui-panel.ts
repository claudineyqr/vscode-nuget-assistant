import * as path from 'node:path';
import * as vscode from 'vscode';
import ConfigPanel from './config-panel';
import WebviewMessageHandler from './services/webview-message-handler';
import { getWebviewHtml } from './webview-html';

export default class UiPanel {
  public static readonly currentPanels: Record<string, UiPanel | undefined> = {};

  private static readonly viewType = 'angular';

  private readonly panel: vscode.WebviewPanel;
  private readonly projectFileUri: vscode.Uri;
  private readonly extensionPath: string;
  private readonly builtAppFolder: string;
  private readonly webviewMessageHandler: WebviewMessageHandler;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionPath: string,
    projectFileUri: vscode.Uri,
    outputChannel: vscode.OutputChannel,
    workspaceState: vscode.Memento
  ) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    const projectFilePath = projectFileUri.fsPath;

    const existingPanel = UiPanel.currentPanels[projectFilePath];

    if (existingPanel) {
      existingPanel.panel.reveal(column);
    } else {
      UiPanel.currentPanels[projectFilePath] = new UiPanel(
        extensionPath,
        column || vscode.ViewColumn.One,
        projectFileUri,
        outputChannel,
        workspaceState
      );
    }
    return UiPanel.currentPanels;
  }

  public static reloadAllForLanguageChange(): void {
    Object.values(UiPanel.currentPanels).forEach((panel) => panel?.reloadForLanguageChange());
  }

  private constructor(
    extensionPath: string,
    column: vscode.ViewColumn,
    projectFileUri: vscode.Uri,
    outputChannel: vscode.OutputChannel,
    workspaceState: vscode.Memento
  ) {
    this.extensionPath = extensionPath;
    this.builtAppFolder = 'dist';
    this.projectFileUri = projectFileUri;

    const projectName = path.basename(this.projectFileUri.fsPath);
    this.panel = vscode.window.createWebviewPanel(UiPanel.viewType, `NuGet Assistant: ${projectName}`, column, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, this.builtAppFolder))],
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.file(path.join(this.extensionPath, 'images', 'logo.png'));

    this.panel.webview.html = this._getHtmlForWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.webviewMessageHandler = new WebviewMessageHandler(
      this.panel.webview,
      this.projectFileUri.fsPath,
      outputChannel,
      workspaceState,
      () => ConfigPanel.createOrShow(extensionPath, outputChannel)
    );
  }

  private dispose() {
    UiPanel.currentPanels[this.projectFileUri.fsPath] = undefined;

    this.webviewMessageHandler.dispose();

    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _getHtmlForWebview(): string {
    return getWebviewHtml(this.extensionPath, this.panel.webview, 'packages');
  }

  private reloadForLanguageChange(): void {
    this.panel.webview.html = this._getHtmlForWebview();
  }
}

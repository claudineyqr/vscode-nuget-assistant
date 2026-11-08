import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import WebviewMessageHandler from './services/webview-message-handler';
import { resolveAppLocale } from './services/locale';

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
      workspaceState
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

  private _getHtmlForWebview() {
    const appDistPath = path.join(this.extensionPath, 'dist');
    const appDistPathUri = vscode.Uri.file(appDistPath);

    const baseUri = this.panel.webview.asWebviewUri(appDistPathUri);

    const indexPath = path.join(appDistPath, 'index.html');

    let indexHtml = fs.readFileSync(indexPath, { encoding: 'utf8' });

    const csp = [
      "default-src 'none'",
      `img-src ${this.panel.webview.cspSource} https: data:`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src ${this.panel.webview.cspSource}`,
      `font-src ${this.panel.webview.cspSource} https: data:`,
      "connect-src 'none'",
      `base-uri ${this.panel.webview.cspSource}`,
      "form-action 'none'",
      "object-src 'none'",
    ].join('; ');

    const languagePreference = vscode.workspace.getConfiguration('nuget-assistant').get<string>('language', 'auto');
    const locale = resolveAppLocale(languagePreference, vscode.env.language);
    indexHtml = indexHtml.replace('<html lang="en">', `<html lang="${locale}">`);
    indexHtml = indexHtml.replace('<head>', `<head>\n  <meta name="nuget-assistant-locale" content="${locale}">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);
    indexHtml = indexHtml.replace('<base href="/">', `<base href="${String(baseUri)}/">`);

    return indexHtml;
  }

  private reloadForLanguageChange(): void {
    this.panel.webview.html = this._getHtmlForWebview();
  }
}

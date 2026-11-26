import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveAppLocale } from './services/locale';

export type WebviewView = 'packages' | 'configurations';

export function getWebviewHtml(extensionPath: string, webview: vscode.Webview, view: WebviewView): string {
  const appDistPath = path.join(extensionPath, 'dist');
  const baseUri = webview.asWebviewUri(vscode.Uri.file(appDistPath));
  let indexHtml = fs.readFileSync(path.join(appDistPath, 'index.html'), { encoding: 'utf8' });

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
    `font-src ${webview.cspSource} https: data:`,
    "connect-src 'none'",
    `base-uri ${webview.cspSource}`,
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');

  const languagePreference = vscode.workspace.getConfiguration('nuget-assistant').get<string>('language', 'auto');
  const locale = resolveAppLocale(languagePreference, vscode.env.language);

  indexHtml = indexHtml.replace('<html lang="en">', `<html lang="${locale}">`);
  indexHtml = indexHtml.replace(
    '<head>',
    `<head>\n  <meta name="nuget-assistant-route" content="${view}">\n  <meta name="nuget-assistant-locale" content="${locale}">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`
  );
  indexHtml = indexHtml.replace('<base href="/">', `<base href="${String(baseUri)}/">`);

  return indexHtml;
}

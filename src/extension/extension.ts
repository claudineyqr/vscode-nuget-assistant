import * as vscode from 'vscode';
import * as quickPick from './services/quick-pick';

import UiPanel from './ui-panel';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('NuGet Assistant');
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand('nuget-assistant.managePackages', (uri: vscode.Uri) => {
      UiPanel.createOrShow(context.extensionPath, uri, outputChannel);
    }),
    vscode.commands.registerCommand('nuget-assistant.managePackagesPalette', async () => {
      const projectFileUri = await quickPick.pickProjectFile();
      if (projectFileUri) {
        UiPanel.createOrShow(context.extensionPath, projectFileUri, outputChannel);
      }
    }),
    vscode.commands.registerCommand('nuget-assistant.manageSolutionPackages', (uri: vscode.Uri) => {
      UiPanel.createOrShow(context.extensionPath, uri, outputChannel);
    }),
    vscode.commands.registerCommand('nuget-assistant.manageSolutionPackagesPalette', async () => {
      const solutionFileUri = await quickPick.pickSolutionFile();
      if (solutionFileUri) {
        UiPanel.createOrShow(context.extensionPath, solutionFileUri, outputChannel);
      }
    })
  );
}

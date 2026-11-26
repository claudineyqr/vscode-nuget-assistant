import * as vscode from 'vscode';
import * as quickPick from './services/quick-pick';
import { ProjectFileEditor, type PackageVersionUpdate } from './services/project-file-editor';

import ConfigPanel from './config-panel';
import UiPanel from './ui-panel';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('NuGet Assistant');
  context.subscriptions.push(outputChannel, 
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('nuget-assistant.language')) {
        UiPanel.reloadAllForLanguageChange();
        ConfigPanel.reloadAllForLanguageChange();
      }
    }),
    vscode.commands.registerCommand('nuget-assistant.managePackages', (uri: vscode.Uri) => {
      UiPanel.createOrShow(context.extensionPath, uri, outputChannel, context.workspaceState);
    }),
    vscode.commands.registerCommand('nuget-assistant.managePackagesPalette', async () => {
      const projectFileUri = await quickPick.pickProjectFile();
      if (projectFileUri) {
        UiPanel.createOrShow(context.extensionPath, projectFileUri, outputChannel, context.workspaceState);
      }
    }),
    vscode.commands.registerCommand('nuget-assistant.manageSolutionPackages', (uri: vscode.Uri) => {
      UiPanel.createOrShow(context.extensionPath, uri, outputChannel, context.workspaceState);
    }),
    vscode.commands.registerCommand('nuget-assistant.manageSolutionPackagesPalette', async () => {
      const solutionFileUri = await quickPick.pickSolutionFile();
      if (solutionFileUri) {
        UiPanel.createOrShow(context.extensionPath, solutionFileUri, outputChannel, context.workspaceState);
      }
    }),
    vscode.commands.registerCommand('nuget-assistant.manageConfigurationsPalette', () => {
      ConfigPanel.createOrShow(context.extensionPath, outputChannel);
    })
  );

  // This command is registered only inside the VS Code extension test host. It lets
  // integration tests exercise the production editor against real project files
  // without adding a command to the extension's user-facing command palette.
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(vscode.commands.registerCommand(
      'nuget-assistant.test.applyProjectFileEdit',
      (request: {
        operation: 'apply' | 'applyMany';
        projectPath: string;
        packageId?: string;
        version?: string;
        updates?: PackageVersionUpdate[];
      }) => {
        const editor = new ProjectFileEditor();
        if (request.operation === 'applyMany') {
          editor.applyMany(request.projectPath, request.updates ?? []);
          return;
        }
        if (!request.packageId) {
          throw new Error('A package ID is required for a single project file edit.');
        }
        editor.apply(request.projectPath, request.packageId, request.version);
      }
    ));
  }
}

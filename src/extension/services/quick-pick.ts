import { workspace, window, Uri } from 'vscode';
import { localize } from './localization';

const filesSearchPattern: string = `**/*.{csproj,vbproj,fsproj}`;
const solutionsSearchPattern: string = `**/*.{sln,slnx}`;

export async function pickSolutionFile(): Promise<Uri | undefined> {
  const solutionFiles = await workspace.findFiles(solutionsSearchPattern, undefined, 32);

  if (solutionFiles.length === 0) {
    window.showWarningMessage(localize('quickPick.noSolutions'));
    return;
  }

  const selectedFile = await window.showQuickPick(
    solutionFiles.map((uri) => ({ label: workspace.asRelativePath(uri), uri })),
    { placeHolder: localize('quickPick.selectSolution'), canPickMany: false }
  );

  if (selectedFile) {
    return selectedFile.uri;
  }

  window.showWarningMessage(localize('quickPick.invalidSolution'));
  return undefined;
}

export async function pickProjectFile(): Promise<Uri | undefined> {
  const projFiles = await workspace.findFiles(filesSearchPattern, undefined, 32);

  if (projFiles.length === 0) {
    window.showWarningMessage(localize('quickPick.noProjects'));
    return;
  }

  const projFileItems = projFiles.map((uri) => ({
    label: workspace.asRelativePath(uri),
    uri: uri,
  }));

  const selectedFile = await window.showQuickPick(projFileItems, {
    placeHolder: localize('quickPick.selectProject'),
    canPickMany: false,
  });

  if (selectedFile) {
    return selectedFile.uri;
  }

  window.showWarningMessage(localize('quickPick.invalidProject'));
  return undefined;
}

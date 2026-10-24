import { workspace, window, Uri } from 'vscode';

const filesSearchPattern: string = `**/*.{csproj,vbproj,fsproj}`;
const solutionsSearchPattern: string = `**/*.{sln,slnx}`;

export async function pickSolutionFile(): Promise<Uri | undefined> {
  const solutionFiles = await workspace.findFiles(solutionsSearchPattern, undefined, 32);

  if (solutionFiles.length === 0) {
    window.showWarningMessage('No solution files found in the current workspace.');
    return;
  }

  const selectedFile = await window.showQuickPick(
    solutionFiles.map((uri) => ({ label: workspace.asRelativePath(uri), uri })),
    { placeHolder: 'Select a solution file', canPickMany: false }
  );

  if (selectedFile) {
    return selectedFile.uri;
  }

  window.showWarningMessage('You have not selected any valid solution file!');
  return undefined;
}

export async function pickProjectFile(): Promise<Uri | undefined> {
  const projFiles = await workspace.findFiles(filesSearchPattern, undefined, 32);

  if (projFiles.length === 0) {
    window.showWarningMessage('No supported project files found in the current workspace.');
    return;
  }

  const projFileItems = projFiles.map((uri) => ({
    label: workspace.asRelativePath(uri),
    uri: uri,
  }));

  const selectedFile = await window.showQuickPick(projFileItems, {
    placeHolder: 'Select a project file',
    canPickMany: false,
  });

  if (selectedFile) {
    return selectedFile.uri;
  }

  window.showWarningMessage('You have not selected any valid project file!');
  return undefined;
}

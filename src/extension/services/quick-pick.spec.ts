import * as vscode from 'vscode';
import * as quickPick from './quick-pick';

describe('quick-pick', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle findFiles returning an array of URIs', async () => {
    const pickedFile = vscode.Uri.file('/path/to/project1.csproj');
    const notPickedFile = vscode.Uri.file('/path/to/project2.csproj');
    const mockFiles = [pickedFile, notPickedFile];

    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'project1.csproj', uri: pickedFile });

    const projectFileUri = await quickPick.pickProjectFile();

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/*.{csproj,vbproj,fsproj}', undefined, 32);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(projectFileUri).toBe(pickedFile);
  });

  it('should handle findFiles returning an array of URIs but user not picking any file', async () => {
    const file1 = vscode.Uri.file('/path/to/project1.csproj');
    const file2 = vscode.Uri.file('/path/to/project2.csproj');
    const mockFiles = [file1, file2];

    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue(mockFiles);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

    const projectFileUri = await quickPick.pickProjectFile();

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/*.{csproj,vbproj,fsproj}', undefined, 32);
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(projectFileUri).toBeUndefined();
  });

  it('should handle findFiles returning an empty array', async () => {
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);

    const projectFileUri = await quickPick.pickProjectFile();

    expect(vscode.workspace.findFiles).toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(projectFileUri).toBeUndefined();
  });

  it('should pick a solution file from the workspace', async () => {
    const solutionFile = vscode.Uri.file('/path/to/sample.sln');
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([solutionFile]);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({ label: 'sample.sln', uri: solutionFile });

    const selectedSolution = await quickPick.pickSolutionFile();

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith('**/*.{sln,slnx}', undefined, 32);
    expect(selectedSolution).toBe(solutionFile);
  });
});

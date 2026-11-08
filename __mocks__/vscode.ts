export const workspace = {
  findFiles: jest.fn(),
  asRelativePath: jest.fn(),
};

export const window = {
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showOpenDialog: jest.fn(),
  showQuickPick: jest.fn(),
};

export const tasks = {
  executeTask: jest.fn(),
  onDidEndTask: jest.fn(),
};

export const Uri = {
  file: jest.fn((path: string) => {
    return {
      fsPath: path,
    };
  }),
};

export const l10n = {
  t: jest.fn((message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)] ?? ''))),
};

export default {
  workspace,
  window,
  tasks,
  Uri,
  l10n,
};

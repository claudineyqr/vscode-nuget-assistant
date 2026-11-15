jest.mock('vscode', () => ({
  Task: class {
    public presentationOptions: unknown = {};
  },
  TaskRevealKind: { Always: 1, Silent: 2 },
  TaskScope: { Workspace: 1 },
  ShellExecution: class {},
  workspace: {
    getConfiguration: jest.fn(),
  },
}), { virtual: true });

import * as vscode from 'vscode';
import WebviewMessageHandler from './webview-message-handler';

describe('WebviewMessageHandler task presentation', () => {
  const getConfiguration = vscode.workspace.getConfiguration as jest.Mock;
  const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), {
    taskName: 'nuget-assistant',
  }) as {
    createTask(command: string, args: never[]): { presentationOptions: unknown };
  };

  beforeEach(() => {
    getConfiguration.mockReset();
  });

  it('always reveals the terminal when the setting is enabled', () => {
    getConfiguration.mockReturnValue({ get: () => true });

    const task = handler.createTask('add', []);

    expect(task.presentationOptions).toEqual({ reveal: 1, focus: false });
  });

  it('silently runs the task when the setting is disabled', () => {
    getConfiguration.mockReturnValue({ get: () => false });

    const task = handler.createTask('add', []);

    expect(task.presentationOptions).toEqual({ reveal: 2, focus: false });
  });

  it('defaults to silent when the setting is missing', () => {
    getConfiguration.mockReturnValue({ get: (_key: string, defaultValue: boolean) => defaultValue });

    const task = handler.createTask('add', []);

    expect(task.presentationOptions).toEqual({ reveal: 2, focus: false });
  });
});

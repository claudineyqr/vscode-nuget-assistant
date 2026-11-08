jest.mock('vscode', () => ({
  Task: class {
    public presentationOptions: unknown = {};
  },
  TaskRevealKind: { Always: 1 },
  TaskScope: { Workspace: 1 },
  ShellExecution: class {},
}), { virtual: true });

import WebviewMessageHandler from './webview-message-handler';

describe('WebviewMessageHandler task presentation', () => {
  it('always reveals the terminal while running package operations', () => {
    const handler = Object.assign(Object.create(WebviewMessageHandler.prototype), {
      taskName: 'nuget-assistant',
    }) as {
      createTask(command: string, args: never[]): { presentationOptions: unknown };
    };

    const task = handler.createTask('add', []);

    expect(task.presentationOptions).toEqual({ reveal: 1, focus: false });
  });
});

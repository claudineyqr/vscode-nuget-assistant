import * as vscode from 'vscode';
import { TaskManager } from './task-manager';

describe('TaskManager package operation progress', () => {
  const tasks = vscode.tasks as unknown as { executeTask: jest.Mock; onDidEndTask: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports the active package as the queue advances, then signals completion', () => {
    const progress: unknown[] = [];
    const finished = jest.fn();
    const manager = new TaskManager((operation) => progress.push(operation), finished);
    const firstTask = { name: 'nuget-assistant' } as vscode.Task;
    const secondTask = { name: 'nuget-assistant' } as vscode.Task;

    manager.executeTask(firstTask, { action: 'update', packageId: 'Package1' });
    manager.executeTask(secondTask, { action: 'remove', packageId: 'Package2' });

    expect(progress).toEqual([{ action: 'update', packageId: 'Package1' }]);
    expect(tasks.executeTask).toHaveBeenCalledTimes(1);
    expect(tasks.executeTask).toHaveBeenLastCalledWith(firstTask);

    const onTaskEnd = tasks.onDidEndTask.mock.calls[0][0] as (event: { execution: { task: vscode.Task } }) => void;
    onTaskEnd({ execution: { task: firstTask } });

    expect(progress).toEqual([
      { action: 'update', packageId: 'Package1' },
      { action: 'remove', packageId: 'Package2' },
    ]);
    expect(tasks.executeTask).toHaveBeenLastCalledWith(secondTask);
    expect(finished).not.toHaveBeenCalled();

    onTaskEnd({ execution: { task: secondTask } });

    expect(finished).toHaveBeenCalledTimes(1);
  });
});

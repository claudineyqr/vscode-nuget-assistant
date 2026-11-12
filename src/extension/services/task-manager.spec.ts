import * as vscode from 'vscode';
import { TaskManager } from './task-manager';

type EndTaskHandler = (event: vscode.TaskEndEvent) => void;
type Listener = { handler: EndTaskHandler; disposable: vscode.Disposable };

describe('TaskManager package operation progress', () => {
  const tasks = vscode.tasks as unknown as { executeTask: jest.Mock; onDidEndTask: jest.Mock };
  let listeners: Listener[];
  let executions: Map<vscode.Task, vscode.TaskExecution>;

  beforeEach(() => {
    jest.clearAllMocks();
    listeners = [];
    executions = new Map();
    tasks.onDidEndTask.mockImplementation((handler: EndTaskHandler) => {
      const disposable = { dispose: jest.fn() };
      listeners.push({ handler, disposable });
      return disposable;
    });
    tasks.executeTask.mockImplementation((task: vscode.Task) => {
      const execution = { task } as vscode.TaskExecution;
      executions.set(task, execution);
      return Promise.resolve(execution);
    });
  });

  it('reports the active package as the queue advances, then signals completion', async () => {
    const progress: unknown[] = [];
    const finished = jest.fn();
    const manager = new TaskManager((operation) => progress.push(operation), finished);
    const firstTask = { name: 'nuget-assistant' } as vscode.Task;
    const secondTask = { name: 'nuget-assistant' } as vscode.Task;

    manager.executeTask(firstTask, { action: 'update', packageId: 'Package1' });
    manager.executeTask(secondTask, { action: 'remove', packageId: 'Package2' });
    await flushPromises();

    expect(progress).toEqual([{ action: 'update', packageId: 'Package1' }]);
    expect(tasks.executeTask).toHaveBeenCalledTimes(1);
    expect(tasks.executeTask).toHaveBeenLastCalledWith(firstTask);

    finishTask(firstTask);
    await flushPromises();

    expect(progress).toEqual([
      { action: 'update', packageId: 'Package1' },
      { action: 'remove', packageId: 'Package2' },
    ]);
    expect(tasks.executeTask).toHaveBeenLastCalledWith(secondTask);
    expect(finished).not.toHaveBeenCalled();

    finishTask(secondTask);

    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('does not advance another manager when a task with the same name ends', async () => {
    const firstFinished = jest.fn();
    const secondFinished = jest.fn();
    const firstManager = new TaskManager(jest.fn(), firstFinished);
    const secondManager = new TaskManager(jest.fn(), secondFinished);
    const firstTask = { name: 'nuget-assistant' } as vscode.Task;
    const secondTask = { name: 'nuget-assistant' } as vscode.Task;

    firstManager.executeTask(firstTask, { action: 'update', packageId: 'Package1' });
    secondManager.executeTask(secondTask, { action: 'update', packageId: 'Package2' });
    await flushPromises();

    finishTask(firstTask);

    expect(firstFinished).toHaveBeenCalledTimes(1);
    expect(secondFinished).not.toHaveBeenCalled();
    expect(tasks.executeTask).toHaveBeenCalledTimes(2);

    finishTask(secondTask);

    expect(secondFinished).toHaveBeenCalledTimes(1);
  });

  it('disposes an idle listener immediately', () => {
    const manager = new TaskManager(jest.fn(), jest.fn());

    manager.dispose();

    expect(listeners[0].disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it('continues queued tasks after disposal without calling panel callbacks', async () => {
    const progress = jest.fn();
    const finished = jest.fn();
    const manager = new TaskManager(progress, finished);
    const firstTask = { name: 'nuget-assistant' } as vscode.Task;
    const secondTask = { name: 'nuget-assistant' } as vscode.Task;

    manager.executeTask(firstTask, { action: 'update', packageId: 'Package1' });
    manager.executeTask(secondTask, { action: 'update', packageId: 'Package2' });
    await flushPromises();
    manager.dispose();

    expect(listeners[0].disposable.dispose).not.toHaveBeenCalled();
    finishTask(firstTask);
    await flushPromises();

    expect(tasks.executeTask).toHaveBeenLastCalledWith(secondTask);
    expect(progress).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
    expect(listeners[0].disposable.dispose).not.toHaveBeenCalled();

    finishTask(secondTask);

    expect(finished).not.toHaveBeenCalled();
    expect(listeners[0].disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it('terminates the active task, discards queued tasks, and reports completion', async () => {
    const finished = jest.fn();
    const firstTask = { name: 'nuget-assistant' } as vscode.Task;
    const secondTask = { name: 'nuget-assistant' } as vscode.Task;
    const manager = new TaskManager(jest.fn(), finished);

    manager.executeTask(firstTask, { action: 'update', packageId: 'Package1' });
    manager.executeTask(secondTask, { action: 'update', packageId: 'Package2' });
    await flushPromises();

    const activeExecution = executions.get(firstTask) as vscode.TaskExecution & { terminate: jest.Mock };
    activeExecution.terminate = jest.fn();
    manager.cancelTasks();

    expect(activeExecution.terminate).toHaveBeenCalledTimes(1);
    expect(tasks.executeTask).toHaveBeenCalledTimes(1);

    finishTask(firstTask);

    expect(finished).toHaveBeenCalledTimes(1);
    expect(tasks.executeTask).toHaveBeenCalledTimes(1);
  });

  it('terminates a task if cancellation arrives before VS Code returns its execution', async () => {
    let resolveExecution: ((execution: vscode.TaskExecution) => void) | undefined;
    tasks.executeTask.mockImplementation(() => new Promise<vscode.TaskExecution>((resolve) => {
      resolveExecution = resolve;
    }));
    const task = { name: 'nuget-assistant' } as vscode.Task;
    const manager = new TaskManager(jest.fn(), jest.fn());
    manager.executeTask(task, { action: 'install', packageId: 'Package1' });
    manager.cancelTasks();

    const execution = { task, terminate: jest.fn() } as unknown as vscode.TaskExecution;
    resolveExecution?.(execution);
    await flushPromises();

    expect(execution.terminate).toHaveBeenCalledTimes(1);
  });

  it('continues the queue if VS Code rejects a task start', async () => {
    const failedTask = { name: 'nuget-assistant' } as vscode.Task;
    const nextTask = { name: 'nuget-assistant' } as vscode.Task;
    const startFailed = jest.fn();
    const finished = jest.fn();
    tasks.executeTask.mockImplementation((task: vscode.Task) => {
      if (task === failedTask) {
        return Promise.reject(new Error('task could not start'));
      }
      const execution = { task } as vscode.TaskExecution;
      executions.set(task, execution);
      return Promise.resolve(execution);
    });
    const manager = new TaskManager(jest.fn(), finished, startFailed);

    manager.executeTask(failedTask, { action: 'update', packageId: 'Package1' });
    manager.executeTask(nextTask, { action: 'update', packageId: 'Package2' });
    await flushPromises();

    expect(startFailed).toHaveBeenCalledWith(new Error('task could not start'), { action: 'update', packageId: 'Package1' });
    expect(tasks.executeTask).toHaveBeenLastCalledWith(nextTask);

    finishTask(nextTask);

    expect(finished).toHaveBeenCalledTimes(1);
  });

  function finishTask(task: vscode.Task): void {
    const execution = executions.get(task);
    if (!execution) {
      throw new Error('Task execution was not recorded.');
    }
    listeners.forEach(({ handler }) => handler({ execution }));
  }

  async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }
});

import * as vscode from 'vscode';
import { PackageOperationStatus } from '../../shared/models/extension-message';

interface QueuedTask {
  task?: vscode.Task;
  prepare?: () => Promise<TaskPreparation>;
  operation: PackageOperationStatus;
  onProcessEnd?: (exitCode: number | undefined) => TaskPreparation | void | Promise<TaskPreparation | void>;
  processExitCode?: number;
}

export interface TaskPreparation {
  task: vscode.Task;
  onProcessEnd?: (exitCode: number | undefined) => TaskPreparation | void | Promise<TaskPreparation | void>;
}

export class TaskManager {
  private readonly currentTasks = new Array<QueuedTask>();
  private readonly taskEndListener: vscode.Disposable;
  private readonly taskProcessEndListener: vscode.Disposable;
  private currentExecution: vscode.TaskExecution | undefined;
  private isDisposed = false;
  private cancellationRequested = false;
  private isFinishingTasks = false;

  constructor(
    private readonly operationChangedCallback: (operation: PackageOperationStatus) => void,
    private readonly tasksFinishedCallback: () => void | Promise<void>,
    private readonly taskStartFailedCallback: (error: unknown, operation: PackageOperationStatus) => void = () => undefined
  ) {
    this.taskEndListener = vscode.tasks.onDidEndTask((taskEvent) => this.handleTaskEnded(taskEvent));
    this.taskProcessEndListener = vscode.tasks.onDidEndTaskProcess?.((event) => {
      const activeTask = this.currentTasks[0];
      if (activeTask && (event.execution === this.currentExecution || event.execution.task === activeTask.task)) {
        activeTask.processExitCode = event.exitCode;
      }
    }) ?? { dispose: () => undefined };
  }

  public executeTask(
    taskOrFactory: vscode.Task | (() => Promise<TaskPreparation>),
    operation: PackageOperationStatus
  ): void {
    if (this.isDisposed) {
      return;
    }

    const shouldStartTask = this.currentTasks.length === 0 && !this.isFinishingTasks;
    const queuedTask: QueuedTask = typeof taskOrFactory === 'function'
      ? { prepare: taskOrFactory, operation }
      : { task: taskOrFactory, operation };
    this.currentTasks.push(queuedTask);
    if (shouldStartTask) {
      this.executeCurrentTask(queuedTask);
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.currentTasks.length === 0) {
      this.taskEndListener.dispose();
      this.taskProcessEndListener.dispose();
    }
  }

  public cancelTasks(): void {
    if (this.currentTasks.length === 0) {
      return;
    }

    if (this.isFinishingTasks) {
      this.currentTasks.splice(0);
      this.cancellationRequested = false;
      return;
    }

    this.cancellationRequested = true;
    this.currentTasks.splice(1);
    this.currentExecution?.terminate();
  }

  private handleTaskEnded(taskEvent: vscode.TaskEndEvent): void {
    const activeTask = this.currentTasks[0];
    if (!activeTask) {
      return;
    }
    const isCurrentExecution = taskEvent.execution === this.currentExecution ||
      (this.currentExecution === undefined && taskEvent.execution.task === activeTask.task);
    if (!isCurrentExecution) {
      return;
    }

    this.currentExecution = undefined;
    void Promise.resolve(activeTask.onProcessEnd?.(activeTask.processExitCode)).catch(() => undefined).then((retry) => {
      if (this.currentTasks[0] !== activeTask) {
        return;
      }
      if (retry) {
        activeTask.task = retry.task;
        activeTask.onProcessEnd = retry.onProcessEnd;
        activeTask.processExitCode = undefined;
        this.executeCurrentTask(activeTask);
        return;
      }
      this.currentTasks.shift();
      if (this.currentTasks.length > 0) {
        this.executeCurrentTask(this.currentTasks[0]);
      } else {
        this.finishTasks();
      }
    });
  }

  private executeCurrentTask(queuedTask: QueuedTask): void {
    if (!this.isDisposed) {
      this.operationChangedCallback(queuedTask.operation);
    }

    const preparation = queuedTask.prepare
      ? Promise.resolve().then(queuedTask.prepare).then((prepared) => {
        queuedTask.task = prepared.task;
        queuedTask.onProcessEnd = prepared.onProcessEnd;
        queuedTask.prepare = undefined;
      })
      : Promise.resolve();
    void preparation.then(() => vscode.tasks.executeTask(queuedTask.task!)).then(
      (execution) => {
        if (this.currentTasks[0] === queuedTask) {
          this.currentExecution = execution;
          if (this.cancellationRequested) {
            execution.terminate();
          }
        }
      },
      (error: unknown) => {
        if (this.currentTasks[0] !== queuedTask) {
          return;
        }

        void Promise.resolve(queuedTask.onProcessEnd?.(undefined)).catch(() => undefined).then(() => {
          if (this.currentTasks[0] !== queuedTask) {
            return;
          }
          this.taskStartFailedCallback(error, queuedTask.operation);
          this.currentTasks.shift();
          this.currentExecution = undefined;
          if (this.currentTasks.length > 0) {
            this.executeCurrentTask(this.currentTasks[0]);
          } else {
            this.finishTasks();
          }
        });
      }
    );
  }

  private finishTasks(): void {
    if (this.isDisposed) {
      this.cancellationRequested = false;
      this.taskEndListener.dispose();
      this.taskProcessEndListener.dispose();
      return;
    }

    this.isFinishingTasks = true;
    this.cancellationRequested = false;
    let completion: void | Promise<void>;
    try {
      completion = this.tasksFinishedCallback();
    } catch {
      completion = undefined;
    }

    void Promise.resolve(completion).catch(() => undefined).then(() => {
      this.isFinishingTasks = false;
      if (this.currentTasks.length > 0) {
        this.executeCurrentTask(this.currentTasks[0]);
      } else if (this.isDisposed) {
        this.taskEndListener.dispose();
        this.taskProcessEndListener.dispose();
      }
    });
  }
}

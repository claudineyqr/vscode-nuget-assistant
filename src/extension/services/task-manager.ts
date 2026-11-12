import * as vscode from 'vscode';
import { PackageOperationStatus } from '../../shared/models/extension-message';

interface QueuedTask {
  task: vscode.Task;
  operation: PackageOperationStatus;
}

export class TaskManager {
  private readonly currentTasks = new Array<QueuedTask>();
  private readonly taskEndListener: vscode.Disposable;
  private currentExecution: vscode.TaskExecution | undefined;
  private isDisposed = false;
  private cancellationRequested = false;

  constructor(
    private readonly operationChangedCallback: (operation: PackageOperationStatus) => void,
    private readonly tasksFinishedCallback: () => void,
    private readonly taskStartFailedCallback: (error: unknown, operation: PackageOperationStatus) => void = () => undefined
  ) {
    this.taskEndListener = vscode.tasks.onDidEndTask((taskEvent) => this.handleTaskEnded(taskEvent));
  }

  public executeTask(task: vscode.Task, operation: PackageOperationStatus): void {
    if (this.isDisposed) {
      return;
    }

    const shouldStartTask = this.currentTasks.length === 0;
    const queuedTask = { task, operation };
    this.currentTasks.push(queuedTask);
    if (shouldStartTask) {
      this.executeCurrentTask(queuedTask);
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.currentTasks.length === 0) {
      this.taskEndListener.dispose();
    }
  }

  public cancelTasks(): void {
    if (this.currentTasks.length === 0) {
      return;
    }

    this.cancellationRequested = true;
    this.currentTasks.splice(1);
    this.currentExecution?.terminate();
  }

  private handleTaskEnded(taskEvent: vscode.TaskEndEvent): void {
    const activeTask = this.currentTasks[0];
    const isCurrentExecution = taskEvent.execution === this.currentExecution ||
      (this.currentExecution === undefined && taskEvent.execution.task === activeTask?.task);
    if (!isCurrentExecution) {
      return;
    }

    this.currentExecution = undefined;
    this.currentTasks.shift();

    if (this.currentTasks.length > 0) {
      this.executeCurrentTask(this.currentTasks[0]);
    } else if (this.isDisposed) {
      this.cancellationRequested = false;
      this.taskEndListener.dispose();
    } else {
      this.cancellationRequested = false;
      this.tasksFinishedCallback();
    }
  }

  private executeCurrentTask(queuedTask: QueuedTask): void {
    if (!this.isDisposed) {
      this.operationChangedCallback(queuedTask.operation);
    }

    void Promise.resolve(vscode.tasks.executeTask(queuedTask.task)).then(
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

        this.taskStartFailedCallback(error, queuedTask.operation);
        this.currentTasks.shift();
        this.currentExecution = undefined;
        if (this.currentTasks.length > 0) {
          this.executeCurrentTask(this.currentTasks[0]);
        } else if (this.isDisposed) {
          this.cancellationRequested = false;
          this.taskEndListener.dispose();
        } else {
          this.cancellationRequested = false;
          this.tasksFinishedCallback();
        }
      }
    );
  }
}

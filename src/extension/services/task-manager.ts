import * as vscode from 'vscode';
import { PackageOperationStatus } from '../../shared/models/extension-message';

interface QueuedTask {
  task: vscode.Task;
  operation: PackageOperationStatus;
}

export class TaskManager {
  private readonly currentTasks = new Array<QueuedTask>();
  private readonly taskName = 'nuget-assistant';

  constructor(
    private operationChangedCallback: (operation: PackageOperationStatus) => void,
    private tasksFinishedCallback: () => void
  ) {
    this.handleFinishedTasks();
  }

  public executeTask(task: vscode.Task, operation: PackageOperationStatus): void {
    const hadOtherTasks = this.currentTasks.length > 0;
    const queuedTask = { task, operation };
    this.currentTasks.push(queuedTask);
    if (!hadOtherTasks) {
      this.executeCurrentTask(queuedTask);
    }
  }

  private handleFinishedTasks(): void {
    vscode.tasks.onDidEndTask((taskEvent: vscode.TaskEndEvent) => {
      const task = taskEvent.execution.task;
      if (task.name === this.taskName) {
        this.currentTasks.shift();

        if (this.currentTasks.length > 0) {
          this.executeCurrentTask(this.currentTasks[0]);
        } else {
          this.tasksFinishedCallback();
        }
      }
    });
  }

  private executeCurrentTask(queuedTask: QueuedTask): void {
    this.operationChangedCallback(queuedTask.operation);
    vscode.tasks.executeTask(queuedTask.task);
  }
}

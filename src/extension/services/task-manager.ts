import * as vscode from 'vscode';

export class TaskManager {
  private readonly currentTasks = new Array<vscode.Task>();
  private readonly taskName = 'nuget-assistant';

  constructor(private tasksFinishedCallback: () => void) {
    this.handleFinishedTasks();
  }

  public executeTask(task: vscode.Task): void {
    const hadOtherTasks = this.currentTasks.length > 0;
    this.currentTasks.push(task);
    if (!hadOtherTasks) {
      vscode.tasks.executeTask(task);
    }
  }

  private handleFinishedTasks(): void {
    vscode.tasks.onDidEndTask((taskEvent: vscode.TaskEndEvent) => {
      const task = taskEvent.execution.task;
      if (task.name === this.taskName) {
        this.currentTasks.shift();

        if (this.currentTasks.length > 0) {
          vscode.tasks.executeTask(this.currentTasks[0]);
        } else {
          this.tasksFinishedCallback();
        }
      }
    });
  }
}

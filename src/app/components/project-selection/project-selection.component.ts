import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { Project } from '../../../shared/models/project';
import { Category } from '../../models/category';
import { PackageRowModel } from '../../models/package-row-model';
import { PackageManagerService } from '../../services/package-manager.service';
import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-project-selection',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './project-selection.component.html',
  styleUrls: ['./project-selection.component.scss'],
})
export class ProjectSelectionComponent extends BaseComponent implements OnInit {
  @Input() public packageToChange: PackageRowModel | null = null;

  public projects: Project[] = [];
  public selectedProjectPaths: string[] = [];
  public showVersion = false;

  constructor(private readonly packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.subscriptions.add(this.packageManager.currentProjects.subscribe((projects) => (this.projects = projects)));
    this.subscriptions.add(this.packageManager.selectedProjectPaths.subscribe((paths) => (this.selectedProjectPaths = paths)));
    this.subscriptions.add(this.packageManager.currentCategory.subscribe((category) => (this.showVersion = category === Category.Updates)));
  }

  public isSelected(projectPath: string): boolean {
    return this.selectedProjectPaths.includes(projectPath);
  }

  public get areAllSelected(): boolean {
    return this.projects.length > 0 && this.projects.every((project) => this.isSelected(project.fsPath));
  }

  public getPackageVersion(project: Project): string {
    return this.isSelected(project.fsPath) ? this.packageToChange?.version ?? '' : '';
  }

  public getInstalledVersion(project: Project): string {
    return project.packages.find((installedPackage) => installedPackage.id === this.packageToChange?.id)?.version ?? '';
  }

  public toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const paths = checked ? this.projects.map((project) => project.fsPath) : [];
    this.packageManager.setSelectedProjectPaths(paths);
  }

  public toggle(projectPath: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const paths = checked
      ? [...this.selectedProjectPaths, projectPath]
      : this.selectedProjectPaths.filter((path) => path !== projectPath);
    this.packageManager.setSelectedProjectPaths(paths);
  }
}

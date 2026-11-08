import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Category } from '../../models/category';
import { PackageManagerService } from '../../services/package-manager.service';

import { BaseComponent } from '../base-component';
import { NgClass } from '@angular/common';

@Component({
    selector: 'app-nav-bar',
    changeDetection: ChangeDetectionStrategy.Eager,
    templateUrl: './nav-bar.component.html',
    styleUrl: './nav-bar.component.css',
    imports: [NgClass],
})
export class NavBarComponent extends BaseComponent implements OnInit {
  public Category = Category;

  public currentCategory = Category.Browse;

  public currentProjectName: string | undefined;
  public currentProjectFsPath: string | undefined;

  constructor(private readonly packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.listenForProjectNameChange();
    this.listenForCurrentCategoryChange();
  }

  public categoryChange(category: Category): void {
    this.packageManager.changeCurrentCategory(category);
  }

  private listenForCurrentCategoryChange(): void {
    this.subscriptions.add(
      this.packageManager.currentCategory.subscribe((category: Category) => {
        this.currentCategory = category;
      })
    );
  }

  private listenForProjectNameChange(): void {
    this.subscriptions.add(
      this.packageManager.currentProject.subscribe((project) => {
        this.currentProjectName = project?.name;
        this.currentProjectFsPath = project?.fsPath;
      })
    );
  }
}

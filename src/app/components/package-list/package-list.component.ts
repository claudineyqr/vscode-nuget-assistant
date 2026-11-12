import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Category } from '../../models/category';
import { PackageRowModel } from '../../models/package-row-model';
import { PackageManagerService } from '../../services/package-manager.service';
import { SelectionService } from '../../services/selection.service';

import { BaseComponent } from '../base-component';

import { PackageRowComponent } from '../package-row/package-row.component';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner.component';

@Component({
    selector: 'app-package-list',
    changeDetection: ChangeDetectionStrategy.Eager,
    templateUrl: './package-list.component.html',
    styleUrl: './package-list.component.css',
    providers: [SelectionService],
    imports: [
    PackageRowComponent,
    LoadingSpinnerComponent
],
})
export class PackageListComponent extends BaseComponent implements OnInit {
  private currentSelectedCategory: Category = Category.Browse;

  public packages: PackageRowModel[] | null = null;

  public currentSelectedPackageId: string | null = null;

  public isSolutionMode = false;

  public get showSelectCheckboxes(): boolean {
    return this.currentSelectedCategory === Category.Updates && this.packages !== null && this.packages.length > 0;
  }

  public get areAllSelected(): boolean {
    if (this.packages === null) {
      return false;
    }
    return this.selectionService.areAllSelected(this.packages);
  }

  constructor(private readonly packageManager: PackageManagerService, public selectionService: SelectionService<PackageRowModel>) {
    super();
  }

  ngOnInit(): void {
    this.listenForCurrentPackages();
    this.listenForCurrentSelectedPackage();
    this.listenForSelectedCategory();
    this.subscriptions.add(this.packageManager.isSolutionMode.subscribe((isSolutionMode) => {
      this.isSolutionMode = isSolutionMode;
    }));
  }

  public selectAll(event: Event): void {
    const isSelected = (event.target as HTMLInputElement).checked;
    if (isSelected) {
      if (this.packages !== null) {
        this.selectionService.selectAll(this.packages);
      }
    } else {
      this.selectionService.clear();
    }
  }

  public selectRow(packageRow: PackageRowModel): void {
    this.selectionService.select(packageRow);
  }

  public deselectRow(packageRow: PackageRowModel): void {
    this.selectionService.deselect(packageRow);
  }

  public updateSelected(): void {
    this.packageManager.installPackages(this.selectionService.selected);
    this.selectionService.clear();
  }

  private listenForCurrentPackages(): void {
    this.subscriptions.add(
      this.packageManager.currentPackages.subscribe((packages: PackageRowModel[] | null) => {
        this.selectionService.clear();
        this.packages = packages;
      })
    );
  }

  private listenForCurrentSelectedPackage() {
    this.subscriptions.add(
      this.packageManager.currentSelectedPackageId.subscribe((selectedPackageId: string | null) => {
        this.currentSelectedPackageId = selectedPackageId;
      })
    );
  }

  private listenForSelectedCategory() {
    this.subscriptions.add(
      this.packageManager.currentCategory.subscribe((selectedCategory: Category) => {
        this.currentSelectedCategory = selectedCategory;
      })
    );
  }
}

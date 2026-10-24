import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { PackageRowModel } from '../../models/package-row-model';
import { CatalogEntry } from '../../models/package-meta';
import { PackageManagerService } from '../../services/package-manager.service';

import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-package-details',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './package-details.component.html',
  styleUrls: ['./package-details.component.scss'],
})
export class PackageDetailsComponent extends BaseComponent implements OnInit {
  public package: PackageRowModel | null = null;
  public isLoading = false;
  private currentSelectedPackageId: string | null = null;

  public selectedVersion: UntypedFormControl = new UntypedFormControl();

  public get selectedVersionObject(): CatalogEntry {
    return this.selectedVersion.value as CatalogEntry;
  }

  constructor(private packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.listenForCurrentSelectedPackageId();
    this.listenForCurrentPackage();
  }

  public install(): void {
    this.packageManager.installPackage(this.package, this.selectedVersionObject.version);
  }

  public uninstall(): void {
    this.packageManager.uninstallPackage(this.package);
  }

  private listenForCurrentPackage(): void {
    this.subscriptions.add(
      this.packageManager.currentSelectedPackage.subscribe((selectedPackage: PackageRowModel | null) => {
        this.package = selectedPackage;
        this.updateLoadingState();
        this.packageManager.prepareProjectSelection(selectedPackage);
        if (this.package) {
          this.selectedVersion.setValue(this.package.versions?.[0]);
        }
      })
    );
  }

  private listenForCurrentSelectedPackageId(): void {
    this.subscriptions.add(
      this.packageManager.currentSelectedPackageId.subscribe((selectedPackageId: string | null) => {
        this.currentSelectedPackageId = selectedPackageId;
        this.updateLoadingState();
      })
    );
  }

  private updateLoadingState(): void {
    this.isLoading = this.currentSelectedPackageId !== null && this.package === null;
  }
}

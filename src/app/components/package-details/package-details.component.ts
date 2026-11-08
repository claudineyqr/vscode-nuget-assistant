import { ChangeDetectionStrategy, Component, Inject, LOCALE_ID, OnInit } from '@angular/core';
import { UntypedFormControl, ReactiveFormsModule } from '@angular/forms';
import { PackageRowModel } from '../../models/package-row-model';
import { CatalogEntry } from '../../models/package-meta';
import { PackageManagerService } from '../../services/package-manager.service';
import { Category } from '../../models/category';

import { BaseComponent } from '../base-component';
import { DatePipe } from '@angular/common';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner.component';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { ProjectSelectionComponent } from '../project-selection/project-selection.component';
import { PackageDetailsVulnerabilitiesComponent } from '../package-details-vulnerabilities/package-details-vulnerabilities.component';
import { PackageDetailsDependenciesComponent } from '../package-details-dependencies/package-details-dependencies.component';
import { PackageDetailsDeprecationComponent } from '../package-details-deprecation/package-details-deprecation.component';

@Component({
  selector: 'app-package-details',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './package-details.component.html',
  styleUrl: './package-details.component.css',
  imports: [
    LoadingSpinnerComponent,
    FaIconComponent,
    ProjectSelectionComponent,
    ReactiveFormsModule,
    PackageDetailsVulnerabilitiesComponent,
    PackageDetailsDependenciesComponent,
    PackageDetailsDeprecationComponent,
    DatePipe
  ],
})
export class PackageDetailsComponent extends BaseComponent implements OnInit {
  public readonly installLabel = $localize`:@@packageDetails.install.button:Install`;
  public readonly updateLabel = $localize`:@@packageDetails.update.button:Update`;
  public package: PackageRowModel | null = null;
  public isLoading = false;
  private currentSelectedPackageId: string | null = null;
  private currentCategory = Category.Browse;
  private readonly numericDateFormatter: Intl.DateTimeFormat;

  public selectedVersion: UntypedFormControl = new UntypedFormControl();

  public get selectedVersionObject(): CatalogEntry | undefined {
    return this.selectedVersion.value as CatalogEntry | undefined;
  }

  public get isSelectedVersionInstalled(): boolean {
    return this.package?.isInstalled === true && this.selectedVersionObject?.version === this.package.installedVersion;
  }

  public get reportAbuseUrl(): string | undefined {
    const packageId = this.package?.id;
    const version = this.selectedVersionObject?.version;
    if (!packageId || !version) {
      return undefined;
    }
    return `https://www.nuget.org/packages/${encodeURIComponent(packageId)}/${encodeURIComponent(version)}/ReportAbuse`;
  }

  constructor(private readonly packageManager: PackageManagerService, @Inject(LOCALE_ID) locale: string) {
    super();
    this.numericDateFormatter = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  public formatNumericDate(date: string): string {
    const timestamp = Date.parse(date);
    return Number.isNaN(timestamp) ? '' : this.numericDateFormatter.format(timestamp);
  }

  ngOnInit(): void {
    this.listenForCurrentSelectedPackageId();
    this.listenForCurrentCategory();
    this.listenForCurrentPackage();
  }

  public install(): void {
    this.packageManager.installPackage(this.package, this.selectedVersionObject?.version ?? '', this.package?.isInstalled ? 'update' : 'install');
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
          const installedVersion = this.currentCategory === Category.Installed && this.package.isInstalled
            ? this.package.versions?.find((version) => version.version === this.package?.installedVersion)
            : undefined;
          this.selectedVersion.setValue(installedVersion ?? this.package.versions?.[0]);
        }
      })
    );
  }

  private listenForCurrentCategory(): void {
    this.subscriptions.add(
      this.packageManager.currentCategory.subscribe((category: Category) => {
        this.currentCategory = category;
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

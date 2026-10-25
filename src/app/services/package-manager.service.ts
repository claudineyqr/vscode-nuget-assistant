import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';

import { Category } from '../models/category';
import { PackageRowModel } from '../models/package-row-model';
import { PackageSource } from '../../shared/models/package-source';
import { InstalledPackage, Project, ProjectSet } from '../../shared/models/project';
import { InstallMessage, UninstallMessage } from '../../shared/models/ui-message';
import { NuGetApiService } from './nuget-api.service';
import { VscodeService } from './vscode.service';
import { ALL_PACKAGE_SOURCES, NUGET_ORG } from '../models/constants';

@Injectable({
  providedIn: 'root',
})
export class PackageManagerService {
  private _currentSources = new BehaviorSubject<PackageSource[]>([]);
  private _preferredSourceUrl: string | undefined;
  public get currentSources(): Observable<PackageSource[]> {
    return this._currentSources.asObservable();
  }

  private _currentCategory = new BehaviorSubject<Category>(Category.Browse);
  public get currentCategory(): Observable<Category> {
    return this._currentCategory.asObservable();
  }

  private _currentProject = new BehaviorSubject<Project | null>(null);
  public get currentProject(): Observable<Project | null> {
    return this._currentProject.asObservable();
  }

  private _currentProjects = new BehaviorSubject<Project[]>([]);
  public get currentProjects(): Observable<Project[]> {
    return this._currentProjects.asObservable();
  }

  private _selectedProjectPaths = new BehaviorSubject<string[]>([]);
  public get selectedProjectPaths(): Observable<string[]> {
    return this._selectedProjectPaths.asObservable();
  }

  private _currentPackages = new BehaviorSubject<PackageRowModel[] | null>(null);
  public get currentPackages(): Observable<PackageRowModel[] | null> {
    return this._currentPackages.asObservable();
  }

  private _currentSelectedPackage = new BehaviorSubject<PackageRowModel | null>(null);
  public get currentSelectedPackage(): Observable<PackageRowModel | null> {
    return this._currentSelectedPackage.asObservable();
  }

  private _currentSelectedPackageId = new BehaviorSubject<string | null>(null);
  public get currentSelectedPackageId(): Observable<string | null> {
    return this._currentSelectedPackageId.asObservable();
  }

  private showOnlyVulnerable = false;

  private _currentSource: PackageSource | undefined;
  private _currentPrerelease = false;
  private activeSearchSubscription: Subscription | undefined;
  private activeSelectedPackageSubscription: Subscription | undefined;

  constructor(private nugetService: NuGetApiService, private vscodeService: VscodeService) {
    vscodeService.postMessage({
      command: 'load-project',
    });
  }

  public queryForPackages(query: string, prerelease: boolean, source: PackageSource): void {
    this.cancelOngoingRequests();
    this._currentSelectedPackage.next(null);
    this._currentSelectedPackageId.next(null);
    this._currentPackages.next(null);

    this._currentSource = source;
    this._currentPrerelease = prerelease;

    const currentCategory = this._currentCategory.value;
    const isAllSources = source === ALL_PACKAGE_SOURCES;
    const sources = this._currentSources.value.length > 0 ? this._currentSources.value : [source === ALL_PACKAGE_SOURCES ? NUGET_ORG : source];

    if (currentCategory === Category.Browse) {
      const search = isAllSources
        ? this.nugetService.searchAll(query, prerelease, sources)
        : this.nugetService.search(query, prerelease, source);
      this.activeSearchSubscription = search.subscribe({
        next: (packageRowModels: PackageRowModel[]) => {
          this.setInstalledInformation(packageRowModels);
          this._currentPackages.next(packageRowModels);
        },
        error: () => {
          this._currentPackages.next([]);
        },
      });
    } else {
      const currentInstalledPackageIds = this.getCurrentInstalledPackageIds();
      if (currentInstalledPackageIds.length) {
        const search = isAllSources
          ? this.nugetService.searchByPackageIdsAll(currentInstalledPackageIds, query, prerelease, sources)
          : this.nugetService.searchByPackageIds(currentInstalledPackageIds, query, prerelease, source);
        this.activeSearchSubscription = search.subscribe({
          next: (packageRowModels: PackageRowModel[]) => {
            this.setInstalledInformation(packageRowModels);
            packageRowModels = this.filterResultsToMatchCategory(packageRowModels);
            this._currentPackages.next(packageRowModels);
          },
          error: () => {
            this._currentPackages.next([]);
          },
        });
      } else {
        this._currentPackages.next([]);
      }
    }
  }

  public changeCurrentProject(project: Project) {
    this._currentProject.next(project);
    this._currentProjects.next([project]);
    this._selectedProjectPaths.next([project.fsPath]);

    const currentPackages = this._currentPackages.value;
    if (currentPackages && project.packages.length) {
      this.setInstalledInformation(currentPackages);
    }
  }

  public changeCurrentProjectSet(projectSet: ProjectSet): void {
    this._currentProjects.next(projectSet.projects);
    this._currentProject.next({
      name: projectSet.name,
      fsPath: projectSet.fsPath,
      packages: projectSet.projects.reduce((packages, project) => {
        project.packages.forEach((installedPackage) => {
          if (!packages.some((packageItem) => packageItem.id === installedPackage.id)) {
            packages.push(installedPackage);
          }
        });
        return packages;
      }, [] as InstalledPackage[]),
    });
    this._selectedProjectPaths.next(projectSet.projects.map((project) => project.fsPath));

    const currentPackages = this._currentPackages.value;
    if (currentPackages) {
      this.setInstalledInformation(currentPackages);
    }
  }

  public prepareProjectSelection(packageToChange: PackageRowModel | null): void {
    if (!packageToChange) {
      this._selectedProjectPaths.next(this._currentProjects.value.map((project) => project.fsPath));
      return;
    }

    const projectPaths = packageToChange.isInstalled
      ? packageToChange.installedProjectPaths ?? []
      : this._currentProjects.value.map((project) => project.fsPath);
    this._selectedProjectPaths.next(projectPaths);
  }

  public setSelectedProjectPaths(projectPaths: string[]): void {
    this._selectedProjectPaths.next(projectPaths);
  }

  public get preferredSourceUrl(): string | undefined {
    return this._preferredSourceUrl;
  }

  public changeCurrentSources(sources: PackageSource[], selectedSourceUrl?: string): void {
    this._preferredSourceUrl = selectedSourceUrl;
    this._currentSources.next(sources);
  }

  public changeCurrentSelectedPackage(selectedPackage: PackageRowModel | null): void {
    this.activeSelectedPackageSubscription?.unsubscribe();
    this.activeSelectedPackageSubscription = undefined;
    this._currentSelectedPackageId.next(selectedPackage?.id ?? null);
    this._currentSelectedPackage.next(null);

    if (selectedPackage == null || selectedPackage.versions !== undefined) {
      this._currentSelectedPackage.next(selectedPackage);
    } else if (this._currentSource) {
      const source =
        this._currentSource === ALL_PACKAGE_SOURCES
          ? this._currentSources.value.find((currentSource) => currentSource.url === selectedPackage.sourceUrl)
          : this._currentSource;
      if (!source) {
        return;
      }
      this.activeSelectedPackageSubscription = this.nugetService.searchByPackageIds([selectedPackage.id], '', this._currentPrerelease, source).subscribe({
        next: (results) => {
          if (this._currentSelectedPackageId.value !== selectedPackage.id) {
            return;
          }

          selectedPackage.versions = results[0]?.versions ?? [];
          this._currentSelectedPackage.next(selectedPackage);
        },
        error: () => {
          if (this._currentSelectedPackageId.value === selectedPackage.id) {
            this._currentSelectedPackageId.next(null);
          }
        },
      });
    }
  }

  public cancelOngoingRequests(): void {
    this.activeSearchSubscription?.unsubscribe();
    this.activeSearchSubscription = undefined;
    this.activeSelectedPackageSubscription?.unsubscribe();
    this.activeSelectedPackageSubscription = undefined;
  }

  public changeCurrentCategory(category: Category): void {
    this._currentCategory.next(category);
  }

  public changeShowOnlyVulnerable(showOnlyVulnerable: boolean): void {
    this.showOnlyVulnerable = showOnlyVulnerable;
  }

  public installPackage(packageToInstall: PackageRowModel | null, version?: string) {
    if (packageToInstall === null) {
      return;
    }

    this.prepareProjectSelection(packageToInstall);
    const installMessage = this.mapPackageToInstallMessage(packageToInstall, version);

    this.vscodeService.postMessage(installMessage);
  }

  public installPackages(packagesToInstall: PackageRowModel[]) {
    if (packagesToInstall.length <= 0) {
      return;
    }

    const installMessages = packagesToInstall.map((p) => this.mapPackageToInstallMessage(p));

    this.vscodeService.postMessages(installMessages);
  }

  public uninstallPackage(packageToUninstall: PackageRowModel | null) {
    if (packageToUninstall === null) {
      return;
    }

    this.prepareProjectSelection(packageToUninstall);
    const projectPaths = this._selectedProjectPaths.value;
    this.vscodeService.postMessage({
      command: 'remove-package',
      projectName: this._currentProject.value?.fsPath,
      packageId: packageToUninstall.id,
      projectPaths: this.getProjectPathsForMessage(projectPaths),
    } as UninstallMessage);
  }

  private mapPackageToInstallMessage(packageToInstall: PackageRowModel, version?: string): InstallMessage {
    const currentProject = this._currentProject.value;
    if (!currentProject) {
      throw new Error('Current project cannot be undefined');
    }

    const versionToInstall = version ?? packageToInstall.version;

    return {
      command: 'add-package',
      projectName: currentProject.fsPath,
      packageId: packageToInstall.id,
      packageVersion: versionToInstall,
      packageSourceUrl: packageToInstall.sourceUrl,
      projectPaths: this.getProjectPathsForMessage(this._selectedProjectPaths.value),
    };
  }

  private setInstalledInformation(packageRowModels: PackageRowModel[]): void {
    const currentProjects = this._currentProjects.value;

    if (currentProjects.length) {
      packageRowModels.forEach((packageRowModel: PackageRowModel) => {
        const installedProjects = currentProjects.filter((project) =>
          project.packages.some((installedPackage: InstalledPackage) => installedPackage.id === packageRowModel.id)
        );
        const installedPackage = installedProjects[0]?.packages.find((candidate) => candidate.id === packageRowModel.id);

        packageRowModel.isInstalled = installedPackage !== undefined;
        packageRowModel.installedVersion = installedPackage ? installedPackage.version : '';
        packageRowModel.installedProjectPaths = installedProjects.map((project) => project.fsPath);
        packageRowModel.isOutdated = packageRowModel.isInstalled && packageRowModel.installedVersion !== packageRowModel.version;
      });
    }
  }

  private filterResultsToMatchCategory(packageRowModels: PackageRowModel[]): PackageRowModel[] {
    const currentCategory = this._currentCategory.value;

    if (currentCategory === Category.Updates) {
      return packageRowModels.filter((packageRowModel: PackageRowModel) => packageRowModel.isOutdated);
    }

    if (currentCategory === Category.Installed && this.showOnlyVulnerable) {
      return packageRowModels.filter((packageRowModel: PackageRowModel) => {
        const installedVersion = packageRowModel.versions?.find((version) => version.version === packageRowModel.installedVersion);
        return (installedVersion?.vulnerabilities?.length ?? 0) > 0;
      });
    }

    return packageRowModels;
  }

  private getCurrentInstalledPackageIds(): string[] {
    return Array.from(new Set(this._currentProjects.value.flatMap((project) => project.packages.map((installedPackage) => installedPackage.id))));
  }

  private getProjectPathsForMessage(projectPaths: string[]): string[] | undefined {
    return this._currentProjects.value.length > 1 ? projectPaths : undefined;
  }
}

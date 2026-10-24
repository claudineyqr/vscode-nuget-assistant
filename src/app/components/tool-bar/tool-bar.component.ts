import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { debounceTime } from 'rxjs/operators';
import { ALL_PACKAGE_SOURCES, NUGET_ORG } from '../../models/constants';
import { Category } from '../../models/category';
import { PackageSource } from '../../../shared/models/package-source';
import { PackageManagerService } from '../../services/package-manager.service';

import { BaseComponent } from '../base-component';
import { VscodeService } from '../../services/vscode.service';

@Component({
  selector: 'app-tool-bar',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './tool-bar.component.html',
  styleUrls: ['./tool-bar.component.scss'],
})
export class ToolBarComponent extends BaseComponent implements OnInit {
  public Category = Category;
  public packageSources: PackageSource[] = [];
  public currentCategory = Category.Browse;

  public readonly searchForm: UntypedFormGroup;

  constructor(private packageManager: PackageManagerService, private fb: UntypedFormBuilder, private vscodeService: VscodeService) {
    super();
    this.searchForm = this.fb.group({
      query: [''],
      prerelease: [false],
      showOnlyVulnerable: [false],
      source: [ALL_PACKAGE_SOURCES],
    });
  }

  ngOnInit(): void {
    this.listenForSourcesChanges();
    this.listenForFormChanges();
    this.listenForCategoryChanges();
  }

  public refresh(): void {
    const query = this.getQueryValue();
    const prerelease = this.getPrereleaseValue();
    const source = this.getSourceValue();

    this.packageManager.changeShowOnlyVulnerable(this.getShowOnlyVulnerableValue());
    this.packageManager.queryForPackages(query, prerelease, source);
  }

  public reloadSources(): void {
    this.vscodeService.postMessage({ command: 'reload-sources' });
  }

  private listenForSourcesChanges(): void {
    this.subscriptions.add(
      this.packageManager.currentSources.subscribe((newSources) => {
        this.packageSources = [ALL_PACKAGE_SOURCES, ...(newSources.length > 0 ? newSources : [NUGET_ORG])];

        this.updateSelectedSource();
      })
    );
  }

  private updateSelectedSource(): void {
    const selectedSource = this.searchForm.get('source')?.value as PackageSource | undefined;
    const matchingSource = this.packageSources.find((source) => source.url === selectedSource?.url) ?? this.packageSources[0];
    if (matchingSource !== selectedSource) {
      this.searchForm.get('source')?.setValue(matchingSource, { emitEvent: false });
    }
  }

  private listenForFormChanges(): void {
    this.subscriptions.add(this.searchForm.valueChanges.pipe(debounceTime(500)).subscribe(() => this.refresh()));
  }

  private listenForCategoryChanges() {
    this.subscriptions.add(
      this.packageManager.currentCategory.subscribe((category) => {
        this.currentCategory = category;
        this.refresh();
      })
    );
  }

  private getQueryValue(): string {
    return this.searchForm.get('query')?.value ?? '';
  }

  private getPrereleaseValue(): boolean {
    return this.searchForm.get('prerelease')?.value ?? false;
  }

  private getShowOnlyVulnerableValue(): boolean {
    return this.searchForm.get('showOnlyVulnerable')?.value ?? false;
  }

  private getSourceValue(): PackageSource {
    return this.searchForm.get('source')?.value ?? ALL_PACKAGE_SOURCES;
  }
}

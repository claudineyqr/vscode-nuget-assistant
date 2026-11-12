import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { PackageRowModel } from '../../models/package-row-model';
import { PackageManagerService } from '../../services/package-manager.service';
import { NgClass, SlicePipe } from '@angular/common';
import { FaIconComponent, FaStackComponent, FaStackItemSizeDirective } from '@fortawesome/angular-fontawesome';

@Component({
  selector: 'app-package-row',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './package-row.component.html',
  styleUrl: './package-row.component.css',
  imports: [
    NgClass,
    FaIconComponent,
    FaStackComponent,
    FaStackItemSizeDirective,
    SlicePipe
  ],
})
export class PackageRowComponent {
  @Input()
  public isActive = false;

  @Input()
  public package: PackageRowModel | null = null;

  @Input()
  public showSelectionCheckbox = false;

  @Input()
  public isSelected = false;

  @Input()
  public hideOperationButtons = false;

  @Output()
  public changeSelect = new EventEmitter<boolean>();

  constructor(private readonly packageManager: PackageManagerService) { }

  public get warningTitle(): string | undefined {
    const installedMetadata = this.package?.isInstalled && this.package.installedVersion === this.package.version
      ? this.package.installedVersionMetadata
      : undefined;
    return this.getWarningTitle(
      Boolean(this.package?.deprecation || installedMetadata?.deprecation),
      (this.package?.vulnerabilities?.length ?? 0) > 0 || (installedMetadata?.vulnerabilities?.length ?? 0) > 0
    );
  }

  public get installedWarningTitle(): string | undefined {
    return this.getWarningTitle(
      Boolean(this.package?.installedVersionMetadata?.deprecation),
      (this.package?.installedVersionMetadata?.vulnerabilities?.length ?? 0) > 0
    );
  }

  private getWarningTitle(isDeprecated: boolean, hasVulnerabilities: boolean): string | undefined {
    const warnings: string[] = [];
    if (isDeprecated) {
      warnings.push($localize`:@@package.deprecatedLabel:Deprecated package`);
    }
    if (hasVulnerabilities) {
      warnings.push($localize`:@@package.vulnerability.warning:This package has vulnerabilities`);
    }
    return warnings.length ? warnings.join('; ') : undefined;
  }

  public select(event: Event): void {
    const newValue = (event.target as HTMLInputElement).checked;
    this.changeSelect.emit(newValue);
  }

  public click(): void {
    this.packageManager.changeCurrentSelectedPackage(this.package);
  }

  public install(event: MouseEvent): void {
    event.stopPropagation();
    this.packageManager.installPackage(this.package, undefined, 'install');
  }

  public uninstall(event: MouseEvent): void {
    event.stopPropagation();
    this.packageManager.uninstallPackage(this.package);
  }

  public update(event: MouseEvent): void {
    event.stopPropagation();
    this.packageManager.installPackage(this.package, undefined, 'update');
  }
}

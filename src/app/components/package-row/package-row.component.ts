import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { PackageRowModel } from '../../models/package-row-model';
import { PackageManagerService } from '../../services/package-manager.service';

@Component({
  selector: 'app-package-row',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './package-row.component.html',
  styleUrls: ['./package-row.component.scss'],
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

  @Output()
  public changeSelect = new EventEmitter<boolean>();

  constructor(private packageManager: PackageManagerService) {}

  public select(event: MouseEvent): void {
    event.stopPropagation();
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

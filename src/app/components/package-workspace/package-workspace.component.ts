import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AngularSplitModule } from 'angular-split';

import { PackageDetailsComponent } from '../package-details/package-details.component';
import { PackageListComponent } from '../package-list/package-list.component';
import { NavBarComponent } from '../nav-bar/nav-bar.component';
import { ToolBarComponent } from '../tool-bar/tool-bar.component';
import { PackageManagerService } from '../../services/package-manager.service';

@Component({
  selector: 'app-package-workspace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    AsyncPipe,
    AngularSplitModule,
    NavBarComponent,
    ToolBarComponent,
    PackageListComponent,
    PackageDetailsComponent,
  ],
  templateUrl: './package-workspace.component.html',
  styleUrl: './package-workspace.component.css',
})
export class PackageWorkspaceComponent {
  constructor(public readonly packageManager: PackageManagerService) {}

  public getOperationLabel(action: 'install' | 'update' | 'remove'): string {
    if (action === 'remove') {
      return $localize`:@@operation.uninstalling:Uninstalling`;
    }
    if (action === 'update') {
      return $localize`:@@operation.updating:Updating`;
    }
    return $localize`:@@operation.installing:Installing`;
  }

  public cancelPackageOperation(): void {
    this.packageManager.cancelCurrentPackageOperation();
  }
}

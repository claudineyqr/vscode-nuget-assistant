import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener } from '@angular/core';
import { AngularSplitModule } from 'angular-split';

import { ExtensionMessage } from '../shared/models/extension-message';
import { PackageSource } from '../shared/models/package-source';
import { Project, ProjectSet } from '../shared/models/project';
import { PackageManagerService } from './services/package-manager.service';
import { NavBarComponent } from './components/nav-bar/nav-bar.component';
import { ToolBarComponent } from './components/tool-bar/tool-bar.component';
import { PackageListComponent } from './components/package-list/package-list.component';
import { PackageDetailsComponent } from './components/package-details/package-details.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [AsyncPipe, AngularSplitModule, NavBarComponent, ToolBarComponent, PackageListComponent, PackageDetailsComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  constructor(public packageManager: PackageManagerService) {}

  public getOperationLabel(action: 'install' | 'update' | 'remove'): string {
    if (action === 'remove') {
      return $localize`:@@operation.uninstalling:Uninstalling`;
    }
    if (action === 'update') {
      return $localize`:@@operation.updating:Updating`;
    }
    return $localize`:@@operation.installing:Installing`;
  }

  @HostListener('window:message', ['$event'])
  MessageFromExtension(event: MessageEvent<ExtensionMessage>) {
    const message = event.data;
    if (message.type === 'project') {
      this.packageManager.changeCurrentProject(message.data as Project);
    } else if (message.type === 'project-set') {
      this.packageManager.changeCurrentProjectSet(message.data as ProjectSet);
    } else if (message.type === 'sources') {
      this.packageManager.changeCurrentSources(message.data as PackageSource[], message.selectedSourceUrl);
    } else if (message.type === 'packages-changed') {
      this.packageManager.refreshCurrentPackages(true);
    } else if (message.type === 'package-operation-progress') {
      this.packageManager.changeCurrentPackageOperation(message.operation ?? null);
    } else if (message.type === 'package-operation-complete') {
      this.packageManager.changeCurrentPackageOperation(null);
    }
  }
}

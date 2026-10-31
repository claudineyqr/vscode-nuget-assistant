import { ChangeDetectionStrategy, Component, HostListener } from '@angular/core';

import { ExtensionMessage } from '../shared/models/extension-message';
import { PackageSource } from '../shared/models/package-source';
import { Project, ProjectSet } from '../shared/models/project';
import { PackageManagerService } from './services/package-manager.service';

@Component({
  selector: 'app-root',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  constructor(public packageManager: PackageManagerService) {}

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
      this.packageManager.refreshCurrentPackages();
    } else if (message.type === 'package-operation-progress') {
      this.packageManager.changeCurrentPackageOperation(message.operation ?? null);
    } else if (message.type === 'package-operation-complete') {
      this.packageManager.changeCurrentPackageOperation(null);
    }
  }
}

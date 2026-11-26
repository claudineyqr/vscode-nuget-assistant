import { Routes } from '@angular/router';

import { NuGetConfigPageComponent } from './components/nuget-config-page/nuget-config-page.component';
import { PackageWorkspaceComponent } from './components/package-workspace/package-workspace.component';

export const appRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'packages' },
  { path: 'packages', component: PackageWorkspaceComponent },
  { path: 'configurations', component: NuGetConfigPageComponent },
];

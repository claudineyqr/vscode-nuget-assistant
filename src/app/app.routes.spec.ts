import { appRoutes } from './app.routes';
import { NuGetConfigPageComponent } from './components/nuget-config-page/nuget-config-page.component';
import { PackageWorkspaceComponent } from './components/package-workspace/package-workspace.component';

describe('appRoutes', () => {
  it('maps the package and configuration views to separate routed components', () => {
    expect(appRoutes).toEqual([
      { path: '', pathMatch: 'full', redirectTo: 'packages' },
      { path: 'packages', component: PackageWorkspaceComponent },
      { path: 'configurations', component: NuGetConfigPageComponent },
    ]);
  });
});

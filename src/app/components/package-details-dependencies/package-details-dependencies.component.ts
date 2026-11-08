import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { PackageDependencyGroup } from '../../models/package-meta';

import { VersionRangePipe } from '../../pipes/version-range.pipe';

@Component({
    selector: 'app-package-details-dependencies',
    changeDetection: ChangeDetectionStrategy.Eager,
    templateUrl: './package-details-dependencies.component.html',
    styleUrl: './package-details-dependencies.component.css',
    imports: [
    VersionRangePipe
],
})
export class PackageDetailsDependenciesComponent {
  @Input()
  public dependencyGroups: PackageDependencyGroup[] | undefined;
}

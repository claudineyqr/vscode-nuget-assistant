import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { PackageDependencyGroup } from '../../models/package-meta';

@Component({
  selector: 'app-package-details-dependencies',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './package-details-dependencies.component.html',
  styleUrls: ['./package-details-dependencies.component.scss'],
})
export class PackageDetailsDependenciesComponent {
  @Input()
  public dependencyGroups: PackageDependencyGroup[] | undefined;
}

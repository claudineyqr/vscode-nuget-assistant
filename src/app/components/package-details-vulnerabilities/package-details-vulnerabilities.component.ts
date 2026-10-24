import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Vulnerability } from '../../models/package-meta';

@Component({
  selector: 'app-package-details-vulnerabilities',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './package-details-vulnerabilities.component.html',
  styleUrls: ['./package-details-vulnerabilities.component.scss'],
})
export class PackageDetailsVulnerabilitiesComponent {
  @Input()
  public vulnerabilities: Vulnerability[] | undefined;
}

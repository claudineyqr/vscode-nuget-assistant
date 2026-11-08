import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Vulnerability } from '../../models/package-meta';

import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { SeverityPipe } from '../../pipes/severity.pipe';

@Component({
    selector: 'app-package-details-vulnerabilities',
    changeDetection: ChangeDetectionStrategy.Eager,
    templateUrl: './package-details-vulnerabilities.component.html',
    styleUrl: './package-details-vulnerabilities.component.css',
    imports: [
    FaIconComponent,
    SeverityPipe
],
})
export class PackageDetailsVulnerabilitiesComponent {
  @Input()
  public vulnerabilities: Vulnerability[] | undefined;
}

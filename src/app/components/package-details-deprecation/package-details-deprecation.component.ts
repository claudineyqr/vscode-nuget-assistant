import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { PackageDeprecation } from '../../models/package-meta';
import { PackageManagerService } from '../../services/package-manager.service';

@Component({
  selector: 'app-package-details-deprecation',
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './package-details-deprecation.component.html',
  styleUrl: './package-details-deprecation.component.css',
  imports: [FaIconComponent],
})
export class PackageDetailsDeprecationComponent {
  constructor(private readonly packageManager: PackageManagerService) { }

  @Input()
  public packageId = '';

  @Input()
  public version = '';

  @Input()
  public deprecation: PackageDeprecation | undefined;

  public get packageInfoUrl(): string {
    return `https://www.nuget.org/packages/${encodeURIComponent(this.packageId)}/${encodeURIComponent(this.version)}`;
  }

  public searchAlternatePackage(event: Event, packageId: string): void {
    event.preventDefault();
    this.packageManager.requestPackageSearch(packageId);
  }

  public get alternatePackageRange(): string | undefined {
    const range = this.deprecation?.alternatePackage?.range?.trim();
    if (!range || range === '*') {
      return undefined;
    }

    if (range.startsWith('[') && range.endsWith(']')) {
      const exactVersion = range.slice(1, -1);
      if (exactVersion.length > 0 && !exactVersion.includes(',') && !exactVersion.includes(']')) {
        return exactVersion.trim();
      }
    }

    const lowerDelimiter = range[0];
    const upperDelimiter = range.at(-1) ?? '';
    if (!['[', '('].includes(lowerDelimiter) || ![']', ')'].includes(upperDelimiter)) {
      return range;
    }

    const bounds = range.slice(1, -1).split(',');
    if (bounds.length !== 2) {
      return range;
    }

    const parts: string[] = [];
    const lower = bounds[0].trim();
    const upper = bounds[1].trim();
    if (lower) {
      parts.push(`${lowerDelimiter === '[' ? '>=' : '>'} ${lower}`);
    }
    if (upper) {
      parts.push(`${upperDelimiter === ']' ? '<=' : '<'} ${upper}`);
    }
    return parts.length ? parts.join($localize`:@@packageDetails.deprecation.rangeAnd: and `) : $localize`:@@packageDetails.deprecation.anyVersion:Any version`;
  }

  public get reasons(): string[] {
    const knownReasons = new Map([
      ['legacy', $localize`:@@packageDetails.deprecation.reason.legacy:Legacy`],
      ['criticalbugs', $localize`:@@packageDetails.deprecation.reason.criticalBugs:Critical bugs`],
      ['other', $localize`:@@packageDetails.deprecation.reason.other:Other`],
    ]);
    const reasons = (this.deprecation?.reasons ?? [])
      .map((reason) => knownReasons.get(reason.toLowerCase()))
      .filter((reason): reason is string => reason !== undefined);
    return reasons.length ? reasons : [$localize`:@@packageDetails.deprecation.reason.other:Other`];
  }
}

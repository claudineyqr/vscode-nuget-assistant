import { Injectable } from '@angular/core';
import { compareVersions, validate } from 'compare-versions';

@Injectable({
  providedIn: 'root',
})
export class VersionService {
  constructor() {}

  public compareSemVers(v1: string, v2: string): 0 | 1 | -1 {
    if (validate(v1) && validate(v2)) {
      return compareVersions(v2, v1);
    }

    const cleanV1 = this.coerce(v1);
    const cleanV2 = this.coerce(v2);
    if (cleanV1 === null || cleanV2 === null) {
      return 0;
    }

    const normalizedComparison = compareVersions(cleanV2, cleanV1);
    if (normalizedComparison !== 0) {
      return normalizedComparison;
    }

    const revision1 = Number(v1.split('.').pop()) || 0;
    const revision2 = Number(v2.split('.').pop()) || 0;
    return revision2 < revision1 ? 1 : revision2 > revision1 ? -1 : 0;
  }

  private coerce(version: string): string | null {
    const match = version.match(/^(?:[^0-9]*)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) {
      return null;
    }

    return `${match[1]}.${match[2] ?? 0}.${match[3] ?? 0}`;
  }
}

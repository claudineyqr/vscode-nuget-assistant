import { Injectable } from '@angular/core';
import { compareVersions, validate } from 'compare-versions';

@Injectable({
  providedIn: 'root',
})
export class VersionService {
  constructor() {}

  public compareSemVers(v1: string, v2: string): 0 | 1 | -1 {
    if (validate(v1) && validate(v2)) {
      const comparison = compareVersions(v1, v2);
      if (comparison === 1) {
        return -1;
      }
      if (comparison === -1) {
        return 1;
      }
      return 0;
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
    if (revision2 < revision1) {
      return 1;
    }
    if (revision2 > revision1) {
      return -1;
    }
    return 0;
  }

  private coerce(version: string): string | null {
    const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version);
    if (!match) {
      return null;
    }

    return `${match[1]}.${match[2] ?? 0}.${match[3] ?? 0}`;
  }
}

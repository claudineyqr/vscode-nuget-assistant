import { TestBed } from '@angular/core/testing';

import { VersionService } from './version.service';

describe('VersionService', () => {
  let service: VersionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VersionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  test.each([
    { v1: '1.2.0', v2: '1.1.0', expected: -1 },
    { v1: '1.1.0', v2: '1.1.0', expected: 0 },
    { v1: '1.0.0', v2: '1.1.0', expected: 1 },
  ])('should directly compare valid semver versions', ({ v1, v2, expected }) => {
    const result = service.compareSemVers(v1, v2);

    expect(result).toBe(expected);
  });

  test.each([
    { v1: '1.0.0.23', v2: '1.0.0.5', expected: -1 },
    { v1: '1.0.0.5', v2: '1.0.0.23', expected: 1 },
    { v1: '1.0.0.23', v2: '1.0.0.23', expected: 0 },
    { v1: '1.0.0.23', v2: '1.0.0', expected: -1 },
    { v1: '1.0.0', v2: '1.0.0.2456', expected: 1 },
  ])('should compare non-semver versions with revision', ({ v1, v2, expected }) => {
    const result = service.compareSemVers(v1, v2);

    expect(result).toBe(expected);
  });

  test.each([
    { v1: 'v1.0.1', v2: 'v1.0.0', expected: -1 },
    { v1: 'v1.0.0', v2: 'v1.0.1', expected: 1 },
    { v1: 'v1.0.0', v2: 'v1.0.0', expected: 0 },
  ])('should handle non-semver versions by coercing them and comparing', ({ v1, v2, expected }) => {
    const result = service.compareSemVers(v1, v2);

    expect(result).toBe(expected);
  });

  it('should return 0 when semver cannot coerce the versions', () => {
    const result = service.compareSemVers('invalid.version', 'another.invalid.version');

    expect(result).toBe(0);
  });
});

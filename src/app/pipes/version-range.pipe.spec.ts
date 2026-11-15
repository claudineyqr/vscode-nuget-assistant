import { VersionRangePipe } from './version-range.pipe';

describe('VersionRangePipe', () => {
  const pipe = new VersionRangePipe();

  it.each([
    ['[1.0,2.0)', '(>=1.0 && <2.0)'],
    ['(1.0,2.0]', '(>1.0 && <=2.0)'],
    ['[1.0,)', '(>=1.0)'],
    ['(,2.0]', '(<=2.0)'],
    ['(,)', '()'],
  ])('formats the NuGet version range %s', (range, expected) => {
    expect(pipe.transform(range)).toBe(expected);
  });
});

import { ShortNumberPipe } from './short-number.pipe';

describe('ShortNumberPipe', () => {
  const pipe = new ShortNumberPipe();

  it.each([
    [null, null],
    [0, '0'],
    [949, '949'],
    [999, '1K'],
    [1_000, '1K'],
    [1_234, '1.2K'],
    [1_000_000, '1M'],
    [1_000_000_000, '1B'],
    [1_000_000_000_000, '1T'],
    [1_000_000_000_000_000, '1Q'],
  ])('formats %s downloads for display', (value, expected) => {
    expect(pipe.transform(value)).toBe(expected);
  });
});

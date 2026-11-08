import { formatErrorMessage } from './error-message';

describe('formatErrorMessage', () => {
  it('redacts credentials from URLs', () => {
    const result = formatErrorMessage('Request failed at https://user:password@feed.example.test/index.json?api_key=secret');

    expect(result).not.toContain('user');
    expect(result).not.toContain('password');
    expect(result).not.toContain('secret');
    expect(result).toContain('https://feed.example.test/index.json?api_key=%5Bredacted%5D');
  });

  it('redacts authorization and token assignments in error text', () => {
    const result = formatErrorMessage('Bearer abc123 access_token=secret refresh-token:private api-key=key123');

    expect(result).not.toContain('abc123');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('private');
    expect(result).not.toContain('key123');
    expect(result).toContain('Bearer [redacted]');
  });

  it('includes the type name when an Error subclass has no message', () => {
    class NetworkError extends Error {
      constructor() {
        super(' ');
        this.name = 'NetworkError';
      }
    }

    expect(formatErrorMessage(new NetworkError())).toBe('NetworkError');
  });
});

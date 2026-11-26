import {
  hasInvalidNuGetConfigCharacters,
  isValidNuGetConfigCredentialValue,
  isValidNuGetConfigSourceName,
  isValidNuGetConfigSourceUrl,
} from './nuget-config-validation';

describe('nuget-config-validation', () => {
  describe('isValidNuGetConfigSourceName', () => {
    it('accepts non-empty names within the length limit', () => {
      expect(isValidNuGetConfigSourceName('nuget.org')).toBe(true);
      expect(isValidNuGetConfigSourceName('Private Feed')).toBe(true);
    });

    it('rejects empty, oversized, and control-character names', () => {
      expect(isValidNuGetConfigSourceName('')).toBe(false);
      expect(isValidNuGetConfigSourceName('   ')).toBe(false);
      expect(isValidNuGetConfigSourceName('a'.repeat(201))).toBe(false);
      expect(isValidNuGetConfigSourceName('feed\nname')).toBe(false);
      expect(isValidNuGetConfigSourceName(42)).toBe(false);
    });
  });

  describe('isValidNuGetConfigSourceUrl', () => {
    it('accepts HTTP, HTTPS, file, and local paths', () => {
      expect(isValidNuGetConfigSourceUrl('https://api.nuget.org/v3/index.json')).toBe(true);
      expect(isValidNuGetConfigSourceUrl('http://localhost:8080/v3/index.json')).toBe(true);
      expect(isValidNuGetConfigSourceUrl('file:///feeds/local/index.json')).toBe(true);
      expect(isValidNuGetConfigSourceUrl('C:\\feeds\\local')).toBe(true);
      expect(isValidNuGetConfigSourceUrl('/var/feeds/local')).toBe(true);
    });

    it('rejects malformed URLs, embedded credentials, and control characters', () => {
      expect(isValidNuGetConfigSourceUrl('')).toBe(false);
      expect(isValidNuGetConfigSourceUrl('https://')).toBe(false);
      expect(isValidNuGetConfigSourceUrl('https://user:pass@example.com/index.json')).toBe(false);
      expect(isValidNuGetConfigSourceUrl('https://example.com/index.json\n')).toBe(false);
      expect(isValidNuGetConfigSourceUrl('a'.repeat(4097))).toBe(false);
    });
  });

  describe('isValidNuGetConfigCredentialValue', () => {
    it('accepts strings within the length limit', () => {
      expect(isValidNuGetConfigCredentialValue('user')).toBe(true);
      expect(isValidNuGetConfigCredentialValue('%PASSWORD%')).toBe(true);
    });

    it('rejects oversized values and control characters', () => {
      expect(isValidNuGetConfigCredentialValue('a'.repeat(4097))).toBe(false);
      expect(isValidNuGetConfigCredentialValue('pass\nword')).toBe(false);
      expect(isValidNuGetConfigCredentialValue(undefined)).toBe(false);
    });
  });

  it('detects control characters', () => {
    expect(hasInvalidNuGetConfigCharacters('feed\tname')).toBe(true);
    expect(hasInvalidNuGetConfigCharacters('feed\u0000name')).toBe(true);
    expect(hasInvalidNuGetConfigCharacters('feed\u007fname')).toBe(true);
    expect(hasInvalidNuGetConfigCharacters('feed-name')).toBe(false);
  });
});

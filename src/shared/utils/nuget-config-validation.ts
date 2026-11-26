const MAX_SOURCE_NAME_LENGTH = 200;
const MAX_SOURCE_VALUE_LENGTH = 4096;

export function hasInvalidNuGetConfigCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function isValidNuGetConfigSourceName(value: unknown): value is string {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_SOURCE_NAME_LENGTH &&
    !hasInvalidNuGetConfigCharacters(value);
}

export function isValidNuGetConfigSourceUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_SOURCE_VALUE_LENGTH ||
    hasInvalidNuGetConfigCharacters(value)
  ) {
    return false;
  }

  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value);
  if (!schemeMatch) {
    return true;
  }

  const scheme = schemeMatch[1].toLowerCase();
  if (scheme === 'http' || scheme === 'https' || scheme === 'file') {
    try {
      const url = new URL(value);
      if (url.username || url.password) {
        return false;
      }
      if ((scheme === 'http' || scheme === 'https') && !url.hostname) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return /^[A-Za-z]:[\\/]/.test(value);
}

export function isValidNuGetConfigCredentialValue(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length <= MAX_SOURCE_VALUE_LENGTH &&
    !hasInvalidNuGetConfigCharacters(value);
}

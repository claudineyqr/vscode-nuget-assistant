import * as net from 'node:net';
import * as path from 'node:path';

export interface ResolvedNetworkAddress {
  address: string;
  family: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidPackageId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value);
}

export function isValidPackageVersion(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return false;
  }

  let version = value;
  if (version.includes('+')) {
    const buildMetadataIndex = version.indexOf('+');
    if (version.slice(buildMetadataIndex + 1).includes('+') || !isValidIdentifierList(version.slice(buildMetadataIndex + 1))) {
      return false;
    }
    version = version.slice(0, buildMetadataIndex);
  }

  if (version.includes('-')) {
    const prereleaseIndex = version.indexOf('-');
    if (!isValidIdentifierList(version.slice(prereleaseIndex + 1))) {
      return false;
    }
    version = version.slice(0, prereleaseIndex);
  }

  const numericParts = version.split('.');
  return numericParts.length <= 4 && numericParts.every((part) => /^(0|[1-9]\d*)$/.test(part));
}

function isValidIdentifierList(value: string): boolean {
  return value.length > 0 && value.split('.').every((part) => /^[0-9A-Za-z-]+$/.test(part));
}

export function parseHttpUrl(value: unknown): URL | undefined {
  if (
    typeof value !== 'string' || value.length === 0 || value.length > 4096 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x20 || codePoint === 0x7f;
    })
  ) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
      return undefined;
    }
    if (Array.from(url.searchParams.keys()).some((name) => /token|password|secret|api[-_]?key|authorization/i.test(name))) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function isValidRequestHeaders(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > 8) {
    return false;
  }
  return Object.entries(value).every(([name, item]) =>
    name.toLowerCase() === 'accept' && typeof item === 'string' && item.length <= 1024 && !/[\r\n]/.test(item)
  );
}

export function validateProjectTargets(selectedPaths: unknown, allowedPaths: string[]): string[] {
  if (!Array.isArray(selectedPaths) || selectedPaths.length === 0 || selectedPaths.length > 100) {
    return [];
  }
  const normalizeForComparison = (candidate: string): string => {
    const resolved = path.resolve(candidate);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const allowed = new Set(allowedPaths.map(normalizeForComparison));
  const normalized = selectedPaths.map((candidate) =>
    typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 4096 ? path.resolve(candidate) : ''
  );
  if (normalized.some((candidate) => !candidate || !allowed.has(normalizeForComparison(candidate)))) {
    return [];
  }
  return Array.from(new Set(normalized));
}

export function shouldSendSourceAuthorization(sourceUrl: URL, requestUrl: URL, authorizationAllowed: boolean): boolean {
  return authorizationAllowed && (sourceUrl.protocol === 'http:' || sourceUrl.protocol === 'https:') &&
    requestUrl.origin === sourceUrl.origin;
}

export function assertHttpCredentialsAllowed(
  requestUrl: URL,
  authorizationWillBeSent: boolean,
  allowInsecureHttpCredentials: boolean
): void {
  if (requestUrl.protocol === 'http:' && authorizationWillBeSent && !allowInsecureHttpCredentials) {
    throw new Error('HTTP requests with NuGet source credentials are disabled. Enable nuget-assistant.allowInsecureHttpCredentials to allow them.');
  }
}

export function redactPackageSourceCredentials<T extends { authorizationHeader?: string }>(sources: T[]): T[] {
  return sources.map((source) => ({ ...source, authorizationHeader: undefined }));
}

export function isPrivateNetworkAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (!net.isIPv6(address)) {
    return true;
  }
  const normalized = address.toLowerCase();
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith('::ffff:');
}

export function selectRequestAddress(addresses: ResolvedNetworkAddress[], sameOriginAsSource: boolean): ResolvedNetworkAddress | undefined {
  const usableAddresses = addresses.filter((item) => net.isIP(item.address) && !isPrivateNetworkAddress(item.address));
  if (!sameOriginAsSource && (usableAddresses.length === 0 || usableAddresses.length !== addresses.length)) {
    throw new Error('The NuGet source URL resolves to a local or private network address.');
  }
  return sameOriginAsSource ? addresses[0] : usableAddresses[0];
}

export function createPinnedAddressLookup(address: ResolvedNetworkAddress): net.LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

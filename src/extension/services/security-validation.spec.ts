import {
  assertHttpCredentialsAllowed,
  createPinnedAddressLookup,
  isPrivateNetworkAddress,
  isRecord,
  isValidPackageId,
  isValidPackageVersion,
  isValidRequestHeaders,
  parseHttpUrl,
  redactPackageSourceCredentials,
  shouldSendSourceAuthorization,
  selectRequestAddress,
  validateProjectTargets,
} from './security-validation';

describe('extension security validation', () => {
  it('accepts safe package identifiers and exact NuGet versions', () => {
    expect(isValidPackageId('Contoso.Package_2-beta')).toBe(true);
    expect(isValidPackageVersion('1.2.3-beta.4+build.9')).toBe(true);
    expect(isValidPackageVersion('1.2.3.4')).toBe(true);
  });

  it.each(['-option', 'name; arbitrary-command', '../package', 'a'.repeat(101), ' trailing'])(
    'rejects an unsafe package identifier: %s',
    (value) => expect(isValidPackageId(value)).toBe(false)
  );

  it.each(['1.2.3; arbitrary-command', '1.2.*', '-1.0', '01.2.3', '1.2.3\n--source'])(
    'rejects an unsafe package version: %s',
    (value) => expect(isValidPackageVersion(value)).toBe(false)
  );

  it('accepts only HTTP(S) URLs without embedded credentials', () => {
    expect(parseHttpUrl('https://packages.example.test/v3/index.json')?.protocol).toBe('https:');
    expect(parseHttpUrl('http://localhost:8080/nuget/index.json')?.protocol).toBe('http:');
    expect(parseHttpUrl('file:///etc/passwd')).toBeUndefined();
    expect(parseHttpUrl('https://user:secret@packages.example.test/index.json')).toBeUndefined();
    expect(parseHttpUrl('https://packages.example.test/index.json?apiKey=secret')).toBeUndefined();
    expect(parseHttpUrl('https://packages.example.test/\nInjected')).toBeUndefined();
  });

  it('accepts bounded Accept headers and rejects credentials supplied by the webview', () => {
    expect(isValidRequestHeaders({ accept: 'application/json' })).toBe(true);
    expect(isValidRequestHeaders({ authorization: 'Bearer secret' })).toBe(false);
    expect(isValidRequestHeaders({ accept: 'application/json\r\nAuthorization: Bearer secret' })).toBe(false);
    expect(isValidRequestHeaders({ accept: 'x'.repeat(1025) })).toBe(false);
    expect(isRecord({ command: 'load-project' })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it('restricts requested project targets to projects discovered from the opened file', () => {
    const allowed = ['workspace/App.csproj', 'workspace/Library.csproj'];
    const selected = validateProjectTargets(['workspace/App.csproj'], allowed);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain('App.csproj');
    expect(validateProjectTargets(['workspace/App.csproj', '../outside/Other.csproj'], allowed)).toEqual([]);
    expect(validateProjectTargets(['workspace/App.csproj', 'workspace/App.csproj'], allowed)).toHaveLength(1);
    expect(validateProjectTargets('workspace/App.csproj', allowed)).toEqual([]);
  });

  it('sends source credentials only to the same configured HTTP(S) origin', () => {
    const source = new URL('https://packages.example.test/v3/index.json');
    expect(shouldSendSourceAuthorization(source, new URL('https://packages.example.test/v3/query'), true)).toBe(true);
    expect(shouldSendSourceAuthorization(source, new URL('https://other.example.test/query'), true)).toBe(false);
    expect(shouldSendSourceAuthorization(new URL('http://packages.example.test/index.json'), new URL('http://packages.example.test/query'), true)).toBe(true);
    expect(shouldSendSourceAuthorization(new URL('http://packages.example.test/index.json'), new URL('https://packages.example.test/query'), true)).toBe(false);
    expect(shouldSendSourceAuthorization(source, new URL('https://packages.example.test/query'), false)).toBe(false);
  });

  it('blocks HTTP requests that would send source credentials unless explicitly allowed', () => {
    const httpUrl = new URL('http://packages.example.test/query');
    const httpsUrl = new URL('https://packages.example.test/query');

    expect(() => assertHttpCredentialsAllowed(httpUrl, true, false)).toThrow(
      'HTTP requests with NuGet source credentials are disabled. Enable nuget-assistant.allowInsecureHttpCredentials to allow them.'
    );
    expect(() => assertHttpCredentialsAllowed(httpUrl, true, true)).not.toThrow();
    expect(() => assertHttpCredentialsAllowed(httpUrl, false, false)).not.toThrow();
    expect(() => assertHttpCredentialsAllowed(httpsUrl, true, false)).not.toThrow();
  });

  it('removes configured feed credentials from messages sent to the webview', () => {
    const sources = [{ name: 'Private', url: 'https://packages.example.test/index.json', authorizationHeader: 'Basic secret' }];
    expect(redactPackageSourceCredentials(sources)).toEqual([
      { name: 'Private', url: 'https://packages.example.test/index.json', authorizationHeader: undefined },
    ]);
    expect(JSON.stringify(redactPackageSourceCredentials(sources))).not.toContain('Basic secret');
  });

  it('identifies local, private, and non-routable addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.4', '192.168.1.2', '169.254.1.1', '::1', 'fd00::1', 'fe80::1']) {
      expect(isPrivateNetworkAddress(address)).toBe(true);
    }
    expect(isPrivateNetworkAddress('8.8.8.8')).toBe(false);
    expect(isPrivateNetworkAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('supports the Node lookup callback format that requests all addresses', () => {
    const address = { address: '2606:4700:4700::1111', family: 6 };
    const callback = jest.fn();

    createPinnedAddressLookup(address)('api.nuget.org', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [address]);
  });

  it('supports the Node lookup callback format that requests a single address', () => {
    const address = { address: '8.8.8.8', family: 4 };
    const callback = jest.fn();

    createPinnedAddressLookup(address)('api.nuget.org', { all: false }, callback);

    expect(callback).toHaveBeenCalledWith(null, address.address, address.family);
  });

  it('returns no selected address for an empty DNS result and rejects private external addresses', () => {
    expect(selectRequestAddress([], true)).toBeUndefined();
    expect(() => selectRequestAddress([{ address: '127.0.0.1', family: 4 }], false)).toThrow(
      'The NuGet source URL resolves to a local or private network address.'
    );
  });
});

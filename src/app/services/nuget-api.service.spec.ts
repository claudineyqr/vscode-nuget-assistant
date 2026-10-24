import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, map, of, throwError } from 'rxjs';
import { PackageSource } from '../../shared/models/package-source';
import { VersionService } from './version.service';
import { NuGetApiService } from './nuget-api.service';

describe('NuGetApiService', () => {
  const source: PackageSource = {
    name: 'Test source',
    url: 'https://packages.example.test/v3/index.json',
    authorizationHeader: undefined,
  };

  it('continues to search NuGet V3 feeds through SearchQueryService', async () => {
    const http = createHttpMock((url, options) => {
      expect(options?.headers?.get('authorization')).toBeNull();
      if (url === source.url) {
        return of(
          JSON.stringify({
            resources: [{ '@id': 'https://packages.example.test/query', '@type': 'SearchQueryService/3.5.0' }],
          })
        );
      }
      return of({
        totalHits: 1,
        data: [
          {
            id: 'Example.Package',
            version: '2.0.0',
            description: 'V3 package',
            authors: 'Example',
            iconUrl: '',
            totalDownloads: 10,
            verified: false,
          },
        ],
      });
    });
    const service = createService(http);

    const results = await firstValueFrom(service.search('Example', false, source));

    expect(results).toHaveLength(1);
    expect(results[0].version).toBe('2.0.0');
    const requestUrl = String((http.get as jest.Mock).mock.calls.map((call: unknown[]) => call[0]).find((url) => String(url).includes('/query')));
    expect(new URL(requestUrl).searchParams.get('q')).toBe('Example');
    expect(new URL(requestUrl).searchParams.get('prerelease')).toBe('false');
    expect(new URL(requestUrl).searchParams.get('semVerLevel')).toBe('2.0.0');
  });

  it('searches NuGet V2 feeds and filters prerelease versions', async () => {
    const v2Source: PackageSource = {
      ...source,
      url: 'https://packages.example.test/api/v2',
      authorizationHeader: 'Basic dXNlcjpwYXNz',
    };
    const http = createHttpMock((url, options) => {
      expect(options?.headers?.get('authorization')).toBeNull();
      if (url === v2Source.url) {
        return of('<service xmlns="http://www.w3.org/2007/app"></service>');
      }
      const isPrerelease = new URL(url).searchParams.get('includePrerelease') === 'true';
      return of(
        v2Feed([
          {
            id: 'Example.Package',
            version: isPrerelease ? '2.0.0-beta' : '1.0.0',
            description: isPrerelease ? 'Preview' : 'Stable',
          },
        ])
      );
    });
    const service = createService(http);

    const stableResults = await firstValueFrom(service.search('Example', false, v2Source));
    const allResults = await firstValueFrom(service.search('Example', true, v2Source));

    expect(stableResults.map((result) => result.version)).toEqual(['1.0.0']);
    expect(allResults.map((result) => result.version)).toEqual(['2.0.0-beta']);
    const searchUrl = (http.get as jest.Mock).mock.calls.map((call: unknown[]) => call[0]).find((requestUrl) => String(requestUrl).includes('/Search()?'));
    expect(searchUrl).toBeDefined();
    expect(new URL(String(searchUrl)).searchParams.get('searchTerm')).toBe("'Example'");
    expect(new URL(String(searchUrl)).searchParams.get('includePrerelease')).toBe('false');
    expect(new URL(String(searchUrl)).searchParams.get('semVerLevel')).toBe('2.0.0');
  });

  it('uses the configured nuget.org V2 feed base and requests an Atom response', async () => {
    const nugetV2: PackageSource = { name: 'nuget.org.v2', url: 'https://nuget.org/api/v2', authorizationHeader: undefined };
    const http = createHttpMock((url, options) => {
      if (url === nugetV2.url) {
        return of('<service xml:base="https://www.nuget.org/api/v2/" xmlns="http://www.w3.org/2007/app"></service>');
      }
      expect(url).toContain('https://www.nuget.org/api/v2/Search()?');
      expect((options?.headers as HttpHeaders).get('Accept')).toContain('application/atom+xml');
      return of(v2Feed([{ id: 'Newtonsoft.Json', version: '13.0.3', description: 'JSON framework' }]));
    });
    const service = createService(http);

    const results = await firstValueFrom(service.search('Newtonsoft.Json', false, nugetV2));

    expect(results.map((result) => result.id)).toEqual(['Newtonsoft.Json']);
  });

  it('loads all package versions from a NuGet V2 feed', async () => {
    const v2Source: PackageSource = {
      ...source,
      url: 'https://packages.example.test/api/v2/',
      authorizationHeader: 'Basic dXNlcjpwYXNz',
    };
    const http = createHttpMock((url, options) => {
      expect(options?.headers?.get('authorization')).toBeNull();
      if (url === v2Source.url) {
        return of('<service xmlns="http://www.w3.org/2007/app"></service>');
      }
      if (new URL(url).searchParams.get('$skip') === '1') {
        return of(v2Feed([{ id: 'Example.Package', version: '1.0.0', description: 'Stable' }]));
      }
      return of(v2Feed([{ id: 'Example.Package', version: '2.0.0-beta', description: 'Preview' }], "?id='Example.Package'&semVerLevel=2.0.0&$skip=1"));
    });
    const service = createService(http);

    const results = await firstValueFrom(service.searchByPackageIds(['Example.Package'], '', false, v2Source));

    expect(results).toHaveLength(1);
    expect(results[0].version).toBe('1.0.0');
    expect(results[0].versions?.map((version) => version.version)).toEqual(['1.0.0']);
    const findByIdUrl = (http.get as jest.Mock).mock.calls.map((call: unknown[]) => call[0]).find((requestUrl) => String(requestUrl).includes('/FindPackagesById()?'));
    expect(findByIdUrl).toBeDefined();
    expect(new URL(String(findByIdUrl)).searchParams.get('id')).toBe("'Example.Package'");
    expect(new URL(String(findByIdUrl)).searchParams.get('semVerLevel')).toBe('2.0.0');
    expect(
      (http.get as jest.Mock).mock.calls.some((call: unknown[]) => new URL(String(call[0])).searchParams.get('$skip') === '1')
    ).toBe(true);
  });

  it('uses the configured GitHub feed and its beta/rc resources for search and versions', async () => {
    const githubSource: PackageSource = {
      name: 'GitHub',
      url: 'https://nuget.pkg.github.com/example-owner/index.json',
      authorizationHeader: 'Basic dXNlcjp0b2tlbg==',
    };
    const http = createHttpMock((url, options) => {
      if (url === githubSource.url) {
        expect(options?.headers?.get('authorization')).toBeNull();
        return of(
          JSON.stringify({
            resources: [
              { '@id': 'https://nuget.pkg.github.com/example-owner/v3/query', '@type': 'SearchQueryService/3.0.0-beta' },
              { '@id': 'https://nuget.pkg.github.com/example-owner/v3/registration/', '@type': 'RegistrationsBaseUrl/3.0.0-rc' },
            ],
          })
        );
      }
      expect(options?.headers?.get('authorization')).toBeNull();
      if (url.startsWith('https://nuget.pkg.github.com/example-owner/v3/query')) {
        return of({
          totalHits: 1,
          data: [{ id: 'Example.Package', version: '1.0.0', description: 'From configured feed', authors: 'Example', iconUrl: '', verified: false }],
        });
      }
      if (url === 'https://nuget.pkg.github.com/example-owner/v3/registration/example.package/index.json') {
        return of({
          count: 1,
          items: [
            {
              '@id': 'https://nuget.pkg.github.com/example-owner/v3/registration/example.package/index.json',
              count: 1,
              items: [
                {
                  '@id': 'https://nuget.pkg.github.com/example-owner/v3/registration/example.package/1.0.0.json',
                  catalogEntry: {
                    '@id': '',
                    id: 'Example.Package',
                    version: '1.0.0',
                    description: 'Version details',
                    authors: 'Example',
                    iconUrl: '',
                    licenseUrl: '',
                    projectUrl: '',
                    tags: '',
                    dependencyGroups: undefined,
                    published: '2026-01-01T00:00:00Z',
                    listed: true,
                    vulnerabilities: undefined,
                  },
                },
              ],
            },
          ],
        });
      }
      return throwError(() => new Error(`Unexpected URL: ${url}`));
    });
    const service = createService(http);

    const searchResults = await firstValueFrom(service.search('Example', false, githubSource));
    const versionResults = await firstValueFrom(service.searchByPackageIds(['Example.Package'], '', false, githubSource));

    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].description).toBe('From configured feed');
    expect(versionResults).toHaveLength(1);
    expect(versionResults[0].versions?.map((version) => version.version)).toEqual(['1.0.0']);
    expect((http.get as jest.Mock).mock.calls.some((call: unknown[]) => call[0] === githubSource.url)).toBe(true);
    expect((http.get as jest.Mock).mock.calls.some((call: unknown[]) => String(call[0]).startsWith('https://api.github.com/'))).toBe(false);
  });

  it('ignores a failed source when searching all configured sources', async () => {
    const healthySource: PackageSource = { ...source, url: 'https://healthy.example/v3/index.json' };
    const unavailableSource: PackageSource = { ...source, name: 'Offline', url: 'https://offline.example/v3/index.json' };
    const http = createHttpMock((url) => {
      if (url === healthySource.url) {
        return of(JSON.stringify({ resources: [{ '@id': 'https://healthy.example/query', '@type': 'SearchQueryService' }] }));
      }
      if (url.startsWith('https://healthy.example/query')) {
        return of({ totalHits: 1, data: [{ id: 'Healthy', version: '1.0.0', description: '', authors: '', iconUrl: '', verified: false }] });
      }
      return throwError(() => new Error('source unavailable'));
    });
    const service = createService(http);

    const results = await firstValueFrom(service.searchAll('', false, [healthySource, unavailableSource]));

    expect(results.map((result) => result.id)).toEqual(['Healthy']);
  });

  it('forwards source request failures to the VS Code Output channel', async () => {
    const unavailableSource: PackageSource = { ...source, name: 'Private feed' };
    const postMessage = jest.fn();
    const http = createHttpMock(() => throwError(() => new Error('401 Unauthorized')));
    const vscodeBridge = {
      postMessage,
      requestText: (url: string, _sourceUrl: string, headers: Record<string, string>) => http.get(url, { headers: new HttpHeaders(headers), responseType: 'text' }).pipe(map((value) => typeof value === 'string' ? value : JSON.stringify(value))),
    };
    const service = new NuGetApiService(new VersionService(), vscodeBridge as never);

    await expect(firstValueFrom(service.search('', false, unavailableSource))).rejects.toThrow('401 Unauthorized');

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'nuget-diagnostic' }));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Private feed') }));
  });

  it('formats structured HTTP errors for Output and removes secrets from the log', async () => {
    const unavailableSource: PackageSource = { ...source, name: 'Private feed' };
    const postMessage = jest.fn();
    const structuredError = {
      status: 403,
      statusText: 'Forbidden',
      message: 'The feed rejected the request',
      error: { message: 'access_token: ghp_example-secret was rejected', requestId: 'request-123' },
    };
    const http = createHttpMock(() => throwError(() => structuredError));
    const vscodeBridge = {
      postMessage,
      requestText: (url: string, _sourceUrl: string, headers: Record<string, string>) => http.get(url, { headers: new HttpHeaders(headers), responseType: 'text' }).pipe(map((value) => typeof value === 'string' ? value : JSON.stringify(value))),
    };
    const service = new NuGetApiService(new VersionService(), vscodeBridge as never);

    await expect(firstValueFrom(service.search('', false, unavailableSource))).rejects.toBe(structuredError);

    const logMessages = postMessage.mock.calls.map(([message]) => message.message).join('\n');
    expect(logMessages).toContain('HTTP 403 Forbidden');
    expect(logMessages).toContain('The feed rejected the request');
    expect(logMessages).toContain('request-123');
    expect(logMessages).not.toContain('[object Object]');
    expect(logMessages).not.toContain('ghp_example-secret');
  });

  function createService(http: HttpClient): NuGetApiService {
    const vscodeBridge = {
      postMessage: jest.fn(),
      requestText: (url: string, _sourceUrl: string, headers: Record<string, string>) => http.get(url, { headers: new HttpHeaders(headers), responseType: 'text' }).pipe(map((value) => typeof value === 'string' ? value : JSON.stringify(value))),
    };
    return new NuGetApiService(new VersionService(), vscodeBridge as never);
  }

  function createHttpMock(handler: (url: string, options?: { headers?: HttpHeaders; [key: string]: unknown }) => unknown): HttpClient {
    return {
      get: jest.fn((url: string, options?: { headers?: HttpHeaders; [key: string]: unknown }) => handler(url, options)),
    } as unknown as HttpClient;
  }

  function v2Feed(packages: Array<{ id: string; version: string; description: string }>, nextHref?: string): string {
    const entries = packages
      .map(
        (item) => `<entry xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"><published>2026-01-01T00:00:00Z</published><content><m:properties><d:Id>${item.id}</d:Id><d:Version>${item.version}</d:Version><d:Description>${item.description}</d:Description><d:Authors>Test</d:Authors></m:properties></content></entry>`
      )
      .join('');
    const nextLink = nextHref ? `<link rel="next" href="${nextHref.replace(/&/g, '&amp;')}" />` : '';
    return `<feed xmlns="http://www.w3.org/2005/Atom">${nextLink}${entries}</feed>`;
  }
});

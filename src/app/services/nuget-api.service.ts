import { HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap, tap, throwError } from 'rxjs';

import { PackageSource } from '../../shared/models/package-source';
import { NuGetDiagnosticMessage } from '../../shared/models/ui-message';
import { formatErrorMessage } from '../../shared/utils/error-message';
import { ApiIndexResponse, ApiResource } from '../models/api-index-response';
import { CatalogEntry, PackageMetaResponse, RegistrationLeaf, RegistrationPage } from '../models/package-meta';
import { PackageRowModel } from '../models/package-row-model';
import { PackageSearchResult, SearchResults } from '../models/search-results';
import { VersionService } from './version.service';
import { VscodeService } from './vscode.service';

type SourceApi = { protocol: 'v2'; endpoint: string } | { protocol: 'v3'; endpoint: string };
type V2FeedPage = { entries: CatalogEntry[]; nextUrl?: string };

@Injectable({
  providedIn: 'root',
})
export class NuGetApiService {
  private readonly VERSIONED = 'Versioned';
  private readonly VERSION360 = '3.6.0';
  private readonly VERSION340 = '3.4.0';
  private readonly VERSION350 = '3.5.0';
  private readonly VERSION30RC = '3.0.0-rc';
  private readonly VERSION30BETA = '3.0.0-beta';
  private readonly VERSION200 = '2.0.0';

  private readonly SEARCH_QUERY_SERVICE = 'SearchQueryService';
  private readonly REGISTRATIONS_BASE_URL = 'RegistrationsBaseUrl';

  private readonly searchQueryServiceEndpoints = [
    `${this.SEARCH_QUERY_SERVICE}/${this.VERSIONED}`,
    `${this.SEARCH_QUERY_SERVICE}/${this.VERSION350}`,
    `${this.SEARCH_QUERY_SERVICE}/${this.VERSION30RC}`,
    `${this.SEARCH_QUERY_SERVICE}/${this.VERSION30BETA}`,
    this.SEARCH_QUERY_SERVICE,
  ];
  private readonly registrationsBaseUrlEndpoints = [
    `${this.REGISTRATIONS_BASE_URL}/${this.VERSIONED}`,
    `${this.REGISTRATIONS_BASE_URL}/${this.VERSION360}`,
    `${this.REGISTRATIONS_BASE_URL}/${this.VERSION340}`,
    `${this.REGISTRATIONS_BASE_URL}/${this.VERSION30RC}`,
    `${this.REGISTRATIONS_BASE_URL}/${this.VERSION30BETA}`,
    this.REGISTRATIONS_BASE_URL,
  ];

  constructor(private versionService: VersionService, private vscodeService: VscodeService) {}

  public search(query: string, prerelease: boolean, source: PackageSource): Observable<PackageRowModel[]> {
    const requestHeaders = new HttpHeaders();
    return this.getSourceApi(source.url, requestHeaders, this.searchQueryServiceEndpoints).pipe(
      switchMap((api) =>
        api.protocol === 'v2'
          ? this.searchV2(query, prerelease, source, api.endpoint)
          : this.executeSearch(query, prerelease, api.endpoint, requestHeaders, source.url).pipe(
              map((results) => this.mapSearchResultsToPackageRows(results.data, source.url))
            )
      ),
      catchError((error: unknown) => {
        this.logDiagnostic(`Search in source "${source.name}" failed: ${this.getErrorMessage(error)}`);
        return throwError(() => error);
      })
    );
  }

  public searchAll(query: string, prerelease: boolean, sources: PackageSource[]): Observable<PackageRowModel[]> {
    return forkJoin(sources.map((source) => this.search(query, prerelease, source).pipe(catchError(() => of([]))))).pipe(
      map((results) => this.mergeSearchResults(results))
    );
  }

  public searchByPackageIds(packageIds: string[], query: string, prerelease: boolean, source: PackageSource): Observable<PackageRowModel[]> {
    const requestHeaders = new HttpHeaders();
    return this.getSourceApi(source.url, requestHeaders, this.registrationsBaseUrlEndpoints).pipe(
      switchMap((api) =>
        api.protocol === 'v2'
          ? this.searchV2PackageIds(packageIds, query, prerelease, source, api.endpoint)
          : this.executeMetadataGets(packageIds, query, prerelease, api.endpoint, requestHeaders, source.url)
      ),
      catchError((error: unknown) => {
        this.logDiagnostic(`Version lookup for source "${source.name}" failed: ${this.getErrorMessage(error)}`);
        return throwError(() => error);
      })
    );
  }

  public searchByPackageIdsAll(
    packageIds: string[],
    query: string,
    prerelease: boolean,
    sources: PackageSource[]
  ): Observable<PackageRowModel[]> {
    return forkJoin(
      sources.map((source) => this.searchByPackageIds(packageIds, query, prerelease, source).pipe(catchError(() => of([]))))
    ).pipe(map((results) => this.mergeSearchResults(results)));
  }

  private executeSearch(query: string, prerelease: boolean, searchApiUrl: string, authHeaders: HttpHeaders, sourceUrl: string): Observable<SearchResults> {
    return this.request<SearchResults>(searchApiUrl, {
      headers: authHeaders,
      params: { q: query, prerelease, semVerLevel: this.VERSION200 },
    }, 'V3 search', sourceUrl);
  }

  private executeMetadataGets(
    packageIds: string[],
    query: string,
    includePrerelease: boolean,
    metaApiUrl: string,
    authHeaders: HttpHeaders,
    sourceUrl: string
  ): Observable<PackageRowModel[]> {
    const requests = packageIds.map((packageId) => {
      const metaApiFullUrl = new URL(`${packageId.toLowerCase()}/index.json`, metaApiUrl).toString();
      return this.request<PackageMetaResponse>(metaApiFullUrl, { headers: authHeaders }, 'V3 package registration', sourceUrl)
        .pipe(
          catchError(() => of(null)),
          switchMap((packageMeta) => this.getRegistrationLeafs(packageMeta, authHeaders, sourceUrl)),
          map((registrationLeafs) => this.getFilteredAndSortedCatalogEntries(registrationLeafs, includePrerelease)),
          map((catalogEntries) => this.convertCatalogEntriesToPackageRow(catalogEntries, packageId, sourceUrl))
        );
    });

    return forkJoin(requests).pipe(
      map((packageRowResults) => this.filterAndSortPackageRowResults(packageRowResults, query))
    );
  }

  private getRegistrationLeafs(packageMeta: PackageMetaResponse | null, authHeaders: HttpHeaders, sourceUrl: string): Observable<RegistrationLeaf[] | null> {
    if (packageMeta === null) {
      return of(null);
    }

    const requests = packageMeta.items.map((page) => {
      if (page.items) {
        return of(page.items);
      }
      return this.request<RegistrationPage>(page['@id'], { headers: authHeaders }, 'V3 registration page', sourceUrl).pipe(
        catchError(() => of(undefined)),
        map((registrationPage) => registrationPage?.items ?? [])
      );
    });

    return forkJoin(requests).pipe(map((pages) => pages.flat()));
  }

  private getFilteredAndSortedCatalogEntries(registrationLeafs: RegistrationLeaf[] | null, includePrerelease: boolean): CatalogEntry[] | null {
    if (registrationLeafs === null) {
      return null;
    }
    const entries = registrationLeafs
      .map((leaf) => leaf.catalogEntry)
      .filter((entry) => (includePrerelease || !this.isPrerelease(entry.version)) && entry.listed !== false);
    entries.sort((left, right) => this.versionService.compareSemVers(left.version, right.version));
    return entries;
  }

  private convertCatalogEntriesToPackageRow(catalogEntries: CatalogEntry[] | null, packageId: string, sourceUrl: string): PackageRowModel | null {
    if (!catalogEntries?.length) {
      return null;
    }
    const latest = catalogEntries[0];
    return {
      id: packageId,
      version: latest.version,
      description: latest.description,
      authors: latest.authors,
      iconUrl: latest.iconUrl,
      totalDownloads: undefined,
      verified: false,
      isInstalled: false,
      installedVersion: '',
      isOutdated: false,
      sourceUrl,
      versions: catalogEntries,
    };
  }

  private filterAndSortPackageRowResults(packageRowResults: (PackageRowModel | null)[], query: string): PackageRowModel[] {
    return (packageRowResults.filter((result) => this.resultMatchesQuery(query, result)) as PackageRowModel[]).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }

  private resultMatchesQuery(query: string, result: PackageSearchResult | null): boolean {
    if (result === null) {
      return false;
    }
    const trimmedQuery = query.trim().toLowerCase();
    return !trimmedQuery || result.id.toLowerCase().includes(trimmedQuery) || result.description.toLowerCase().includes(trimmedQuery);
  }

  private getSourceApi(sourceUrl: string, headers: HttpHeaders, preferredEndpoints: string[]): Observable<SourceApi> {
    return this.request<string>(sourceUrl, { headers, responseType: 'text' }, 'NuGet service index', sourceUrl).pipe(
      map((body) => {
        let index: ApiIndexResponse;
        try {
          index = JSON.parse(body) as ApiIndexResponse;
        } catch {
          if (/<(?:\w+:)?(?:feed|service)\b/i.test(body)) {
            const document = new DOMParser().parseFromString(body, 'application/xml');
            const serviceElement = Array.from(document.getElementsByTagName('*')).find((element) => element.localName.toLowerCase() === 'service');
            const xmlBase = serviceElement?.getAttribute('xml:base') ?? serviceElement?.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'base');
            const endpoint = xmlBase ? new URL(xmlBase, sourceUrl).toString() : sourceUrl.replace(/\/+$/, '');
            return { protocol: 'v2', endpoint } as SourceApi;
          }
          throw new Error(`The package source "${sourceUrl}" is not a valid NuGet V2 or V3 feed.`);
        }

        const found = index.resources?.find((resource: ApiResource) => preferredEndpoints.includes(resource['@type']));
        if (!found) {
          throw new Error(`The package source "${sourceUrl}" does not expose the required NuGet V3 resource.`);
        }
        return { protocol: 'v3', endpoint: found['@id'] } as SourceApi;
      })
    );
  }

  private searchV2(query: string, includePrerelease: boolean, source: PackageSource, endpoint: string): Observable<PackageRowModel[]> {
    const headers = new HttpHeaders();
    const url = this.getV2OperationUrl(endpoint, 'Search()', {
      searchTerm: `'${this.escapeOData(query.trim())}'`,
      targetFramework: "''",
      includePrerelease: String(includePrerelease),
      semVerLevel: this.VERSION200,
    });
    return this.getAllV2Entries(url, headers, source.name, 'V2 Search()', source.url).pipe(
      map((allEntries) => {
        const entries = allEntries.filter((entry) => includePrerelease || !this.isPrerelease(entry.version));
        const byId = new Map<string, CatalogEntry>();
        for (const entry of entries) {
          const existing = byId.get(entry.id.toLowerCase());
          if (!existing || this.versionService.compareSemVers(entry.version, existing.version) < 0) {
            byId.set(entry.id.toLowerCase(), entry);
          }
        }
        return Array.from(byId.values())
          .map((entry) => this.convertCatalogEntriesToPackageRow([entry], entry.id, source.url))
          .filter((row): row is PackageRowModel => row !== null)
          .sort((left, right) => left.id.localeCompare(right.id));
      })
    );
  }

  private searchV2PackageIds(packageIds: string[], query: string, includePrerelease: boolean, source: PackageSource, endpoint: string): Observable<PackageRowModel[]> {
    const headers = new HttpHeaders();
    const requests = packageIds.map((packageId) => {
      const url = this.getV2OperationUrl(endpoint, 'FindPackagesById()', {
        id: `'${this.escapeOData(packageId)}'`,
        semVerLevel: this.VERSION200,
      });
      return this.getAllV2Entries(url, headers, source.name, 'V2 FindPackagesById()', source.url).pipe(
        catchError(() => of([] as CatalogEntry[])),
        map((entries) => entries.filter((entry) => includePrerelease || !this.isPrerelease(entry.version))),
        map((entries) => {
          entries.sort((left, right) => this.versionService.compareSemVers(left.version, right.version));
          return this.convertCatalogEntriesToPackageRow(entries, packageId, source.url);
        })
      );
    });
    return forkJoin(requests).pipe(map((results) => this.filterAndSortPackageRowResults(results, query)));
  }

  private getV2OperationUrl(sourceUrl: string, operation: string, parameters: Record<string, string>): string {
    const url = new URL(sourceUrl);
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/(?:packages|search\(\)|findpackagesbyid\(\))$/i.test(path)) {
      url.pathname = path.slice(0, path.lastIndexOf('/'));
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${operation}`;
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }

  private getAllV2Entries(
    url: string,
    headers: HttpHeaders,
    sourceName: string,
    operation: string,
    sourceUrl: string,
    visited = new Set<string>(),
    entries: CatalogEntry[] = []
  ): Observable<CatalogEntry[]> {
    if (visited.has(url)) {
      return of(entries);
    }
    visited.add(url);
    const requestHeaders = headers.set('Accept', 'application/atom+xml, application/atomsvc+xml, application/xml;q=0.9, application/json;q=0.8, */*;q=0.5');
    return this.request<string>(url, { headers: requestHeaders, responseType: 'text' }, `${operation} (${sourceName})`, sourceUrl).pipe(
      switchMap((body) => {
        const page = this.parseV2FeedPage(body, url);
        const allEntries = [...entries, ...page.entries];
        return page.nextUrl ? this.getAllV2Entries(page.nextUrl, headers, sourceName, operation, sourceUrl, visited, allEntries) : of(allEntries);
      })
    );
  }

  private parseV2FeedPage(xml: string, currentUrl: string): V2FeedPage {
    const trimmed = xml.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const payload = JSON.parse(trimmed) as Record<string, unknown>;
        const data = (payload['d'] ?? payload) as Record<string, unknown>;
        const rawEntries = (data['results'] ?? data['value'] ?? (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
        const entries = rawEntries.map((item) => this.mapV2JsonEntry(item)).filter((entry): entry is CatalogEntry => entry !== null);
        const next = (data['__next'] ?? data['@odata.nextLink'] ?? payload['@odata.nextLink']) as string | undefined;
        return { entries, nextUrl: next ? new URL(next, currentUrl).toString() : undefined };
      } catch (error) {
        throw new Error(`The NuGet V2 source returned invalid JSON: ${this.getErrorMessage(error)}`);
      }
    }
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror').length) {
      throw new Error('The NuGet V2 source returned neither a valid Atom feed nor valid OData JSON.');
    }
    const nextLink = Array.from(document.getElementsByTagName('*')).find(
      (element) => element.localName.toLowerCase() === 'link' && element.getAttribute('rel')?.toLowerCase() === 'next'
    );
    const nextHref = nextLink?.getAttribute('href');
    return {
      entries: this.parseV2Entries(document),
      nextUrl: nextHref ? new URL(nextHref, currentUrl).toString() : undefined,
    };
  }

  private mapV2JsonEntry(item: Record<string, unknown>): CatalogEntry | null {
    const id = String(item['Id'] ?? item['id'] ?? '');
    const version = String(item['Version'] ?? item['version'] ?? '');
    if (!id || !version) {
      return null;
    }
    const unwrap = (value: unknown): string => {
      if (value && typeof value === 'object' && '__metadata' in value) {
        return String((value as Record<string, unknown>)['__text'] ?? '');
      }
      return value == null ? '' : String(value);
    };
    return {
      '@id': String(item['@id'] ?? ''),
      id,
      version,
      description: unwrap(item['Description']),
      authors: unwrap(item['Authors']),
      iconUrl: unwrap(item['IconUrl']),
      licenseUrl: unwrap(item['LicenseUrl']),
      projectUrl: unwrap(item['ProjectUrl']),
      tags: unwrap(item['Tags']),
      dependencyGroups: undefined,
      published: unwrap(item['Published']),
      listed: item['Listed'] !== false,
      vulnerabilities: undefined,
    };
  }

  private parseV2Entries(document: Document): CatalogEntry[] {
    return Array.from(document.getElementsByTagName('*'))
      .filter((element) => element.localName.toLowerCase() === 'entry')
      .map((entry) => {
        const props = Array.from(entry.getElementsByTagName('*')).find((element) => element.localName.toLowerCase() === 'properties');
        const values = new Map<string, string>();
        if (props) {
          Array.from(props.children).forEach((element) => values.set(element.localName.toLowerCase(), element.textContent ?? ''));
        }
        const value = (name: string): string => values.get(name.toLowerCase()) ?? '';
        const published = entry.getElementsByTagName('*');
        const publishedElement = Array.from(published).find((element) => element.localName.toLowerCase() === 'published');
        const id = value('id');
        const version = value('version');
        return {
          '@id': '',
          id,
          version,
          description: value('description'),
          authors: value('authors'),
          iconUrl: value('iconurl'),
          licenseUrl: value('licenseurl'),
          projectUrl: value('projecturl'),
          tags: value('tags'),
          dependencyGroups: undefined,
          published: publishedElement?.textContent ?? '',
          listed: true,
          vulnerabilities: undefined,
        };
      })
      .filter((entry) => !!entry.id && !!entry.version);
  }

  private mapSearchResultsToPackageRows(
    packageSearchResults: PackageSearchResult[],
    sourceUrl: string,
    versions: CatalogEntry[] | undefined = undefined
  ): PackageRowModel[] {
    return packageSearchResults.map((result) => ({
      ...result,
      isInstalled: false,
      installedVersion: '',
      isOutdated: false,
      sourceUrl,
      versions,
    }));
  }

  private mergeSearchResults(results: PackageRowModel[][]): PackageRowModel[] {
    const uniqueResults = new Map<string, PackageRowModel>();
    results.flat().forEach((result) => {
      if (!uniqueResults.has(result.id.toLowerCase())) {
        uniqueResults.set(result.id.toLowerCase(), result);
      }
    });
    return Array.from(uniqueResults.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  private isPrerelease(version: string): boolean {
    return version.split('+')[0].includes('-');
  }

  private escapeOData(value: string): string {
    return value.replace(/'/g, "''");
  }

  private request<T>(url: string, options: object, operation: string, sourceUrl: string): Observable<T> {
    this.logDiagnostic(`${operation}: GET ${this.sanitizeUrl(url)}`);
    const requestOptions = options as { headers?: HttpHeaders; params?: Record<string, string | boolean>; responseType?: 'text' };
    const requestUrl = new URL(url);
    Object.entries(requestOptions.params ?? {}).forEach(([name, value]) => requestUrl.searchParams.set(name, String(value)));
    const request: Observable<T> = this.vscodeService.requestText(requestUrl.toString(), sourceUrl, this.toHeaderRecord(requestOptions.headers)).pipe(
      map((body) => requestOptions.responseType === 'text' ? body : JSON.parse(body) as T)
    ) as Observable<T>;
    return request.pipe(
      tap({ next: () => this.logDiagnostic(`${operation}: resposta recebida de ${this.sanitizeUrl(url)}`) }),
      catchError((error: unknown) => {
        const details = this.describeHttpError(error);
        this.logDiagnostic(`${operation}: falha em ${this.sanitizeUrl(url)} - ${details}`);
        return throwError(() => error);
      })
    );
  }

  private toHeaderRecord(headers: HttpHeaders | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    headers?.keys().forEach((key) => {
      const value = headers.get(key);
      if (value !== null) {
        result[key] = value;
      }
    });
    return result;
  }

  private describeHttpError(error: unknown): string {
    return formatErrorMessage(error);
  }

  private getErrorMessage(error: unknown): string {
    return formatErrorMessage(error);
  }

  private sanitizeUrl(value: string): string {
    try {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      for (const key of Array.from(url.searchParams.keys())) {
        if (/token|password|secret|key|auth/i.test(key)) {
          url.searchParams.set(key, '[redacted]');
        }
      }
      return url.toString();
    } catch {
      return value.replace(/(token|password|secret|key|auth)=([^&]+)/gi, '$1=[redacted]');
    }
  }

  private logDiagnostic(message: string): void {
    this.vscodeService.postMessage({ command: 'nuget-diagnostic', message } as NuGetDiagnosticMessage);
  }
}

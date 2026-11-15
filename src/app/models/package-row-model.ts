import { CatalogEntry } from './package-meta';
import { PackageSearchResult } from './search-results';

export interface PackageRowModel extends PackageSearchResult {
  installedVersion: string;
  installedVersionMetadata?: CatalogEntry;
  installedProjectPaths?: string[];
  isInstalled: boolean;
  isOutdated: boolean;
  sourceName?: string;
  sourceUrl: string;
  versions: CatalogEntry[] | undefined;
}

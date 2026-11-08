import { PackageDeprecation, Vulnerability } from './package-meta';

export interface SearchResults {
  totalHits: number;
  data: PackageSearchResult[];
}

export interface PackageSearchResult {
  id: string;
  version: string;
  description: string;
  authors: string | string[];
  iconUrl: string;
  verified: boolean;
  deprecation?: PackageDeprecation;
  vulnerabilities?: Vulnerability[];
}

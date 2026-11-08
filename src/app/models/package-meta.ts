export interface PackageMetaResponse {
  count: number;
  items?: RegistrationPage[];
}

export interface RegistrationPage {
  '@id': string;
  count: number;
  items?: RegistrationLeaf[];
}

export interface RegistrationLeaf {
  '@id': string;
  catalogEntry: CatalogEntry;
}

export interface CatalogEntry {
  '@id': string;
  id: string;
  version: string;
  description: string;
  authors: string | string[];
  iconUrl: string;
  licenseUrl: string;
  projectUrl: string;
  tags: string | string[];
  dependencyGroups: PackageDependencyGroup[] | undefined;
  published: string;
  listed?: boolean;
  vulnerabilities: Vulnerability[] | undefined;
  deprecation?: PackageDeprecation;
}

export interface PackageDeprecation {
  reasons?: string[];
  message?: string;
  alternatePackage?: AlternatePackage;
}

export interface AlternatePackage {
  id: string;
  range?: string;
}

export interface PackageDependencyGroup {
  targetFramework: string;
  dependencies: PackageDependency[] | undefined;
}

export interface PackageDependency {
  id: string;
  range: string;
}

export interface Vulnerability {
  advisoryUrl: string;
  severity: string;
}

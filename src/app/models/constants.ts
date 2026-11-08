import { PackageSource } from '../../shared/models/package-source';

export const NUGET_ORG: PackageSource = {
  name: 'nuget.org',
  url: 'https://api.nuget.org/v3/index.json',
  authorizationHeader: undefined,
};

export const ALL_PACKAGE_SOURCES: PackageSource = {
  name: 'All',
  url: '',
  authorizationHeader: undefined,
};

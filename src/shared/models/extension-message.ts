import { NuGetConfigSnapshot } from './nuget-config';
import { PackageSource } from './package-source';
import { Project, ProjectSet } from './project';

export interface ExtensionMessage {
  type: string;
  data?: Project | ProjectSet | PackageSource[] | NuGetConfigSnapshot;
  selectedSourceUrl?: string;
  operation?: PackageOperationStatus;
  error?: string;
}

export interface PackageOperationStatus {
  action: 'install' | 'update' | 'remove';
  packageId: string;
  packageCount?: number;
}

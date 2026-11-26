import { NuGetConfigSourceUpdate } from './nuget-config';

export interface UIMessage {
  command: string;
}

export interface OpenNuGetConfigPageMessage extends UIMessage {
  command: 'open-nuget-config-page';
}

export interface LoadNuGetConfigMessage extends UIMessage {
  command: 'load-nuget-config';
  filePath?: string;
}

export interface SaveNuGetConfigMessage extends UIMessage {
  command: 'save-nuget-config';
  filePath: string;
  sources: NuGetConfigSourceUpdate[];
}

export interface SelectSourceMessage extends UIMessage {
  command: 'select-source';
  sourceUrl: string;
}

export interface NuGetDiagnosticMessage extends UIMessage {
  command: 'nuget-diagnostic';
  message: string;
  severity?: 'information' | 'error';
}

export interface NuGetHttpRequestMessage extends UIMessage {
  command: 'nuget-http-request';
  requestId: string;
  url: string;
  sourceUrl: string;
  headers: Record<string, string>;
}

export interface UninstallMessage extends UIMessage {
  projectName: string;
  packageId: string;
  projectPaths?: string[];
}

export interface InstallMessage extends UninstallMessage {
  packageVersion: string;
  packageSourceUrl: string;
  operation: 'install' | 'update';
}

export interface InstallPackagesMessage extends UIMessage {
  command: 'add-packages';
  packages: InstallMessage[];
}

export interface CancelPackageOperationMessage extends UIMessage {
  command: 'cancel-package-operation';
}

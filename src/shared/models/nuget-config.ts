export type NuGetConfigFileKind = 'user' | 'additional' | 'project';

export interface NuGetConfigFileInfo {
  path: string;
  kind: NuGetConfigFileKind;
  exists: boolean;
}

export interface NuGetConfigSource {
  name: string;
  url: string;
  enabled: boolean;
  username?: string;
  hasPassword: boolean;
}

export interface NuGetConfigSnapshot {
  files: NuGetConfigFileInfo[];
  selectedFilePath: string;
  fileExists: boolean;
  sources: NuGetConfigSource[];
}

export type NuGetConfigCredentialAction = 'keep' | 'replace' | 'remove';

export interface NuGetConfigSourceCredentialsUpdate {
  action: NuGetConfigCredentialAction;
  username?: string;
  password?: string;
}

export interface NuGetConfigSourceUpdate {
  name: string;
  url: string;
  enabled: boolean;
  originalName?: string;
  credentials?: NuGetConfigSourceCredentialsUpdate;
}

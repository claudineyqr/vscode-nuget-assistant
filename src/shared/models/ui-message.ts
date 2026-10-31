export interface UIMessage {
  command: string;
}

export interface SelectSourceMessage extends UIMessage {
  command: 'select-source';
  sourceUrl: string;
}

export interface NuGetDiagnosticMessage extends UIMessage {
  command: 'nuget-diagnostic';
  message: string;
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

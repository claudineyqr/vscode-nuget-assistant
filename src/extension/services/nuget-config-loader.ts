import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as xml2js from 'xml2js';
import { PackageSource } from '../../shared/models/package-source';
import { formatErrorMessage } from '../../shared/utils/error-message';
import { NuGetDataParsingError } from '../../shared/utils/nuget-data-parsing-error';
import { localize } from './localization';

type FileSystem = Pick<typeof fs.promises, 'readFile' | 'readdir'>;

type NuGetConfig = {
  configuration?: {
    packageSources?: Array<{ add?: Array<XmlEntry>; clear?: unknown[]; remove?: Array<XmlEntry> }>;
    disabledPackageSources?: Array<{ add?: Array<XmlEntry>; clear?: unknown[]; remove?: Array<XmlEntry> }>;
    packageSourceCredentials?: Array<Record<string, Array<{ add?: Array<XmlEntry> }>>>;
  };
};

type XmlEntry = {
  $?: {
    key?: string;
    value?: string;
  };
};

type SourceCredentials = {
  username?: string;
  clearTextPassword?: string;
};

export default class NuGetConfigLoader {
  public constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly fileSystem: FileSystem = fs.promises,
    private readonly logger: (message: string) => void = () => undefined
  ) {}

  public async loadAsync(projectFilePath: string): Promise<PackageSource[]> {
    const configPaths = await this.getConfigPathsAsync(projectFilePath);
    this.logger(`Loading NuGet configuration from ${configPaths.length} file(s).`);
    const sources = new Map<string, PackageSource>();
    const disabledSources = new Map<string, boolean>();
    const credentials = new Map<string, SourceCredentials>();

    const configResults = await Promise.all(configPaths.map(async (configPath) => {
      this.logger(`Reading ${configPath}`);
      try {
        const content = await this.fileSystem.readFile(configPath, 'utf8');
        try {
          const config = (await xml2js.parseStringPromise(content)) as NuGetConfig;
          return { success: true as const, configPath, config };
        } catch (error) {
          return {
            success: false as const,
            error: new NuGetDataParsingError(localize('error.invalidNugetConfigXml', configPath, formatErrorMessage(error))),
          };
        }
      } catch (error) {
        return { success: false as const, error };
      }
    }));

    for (const result of configResults) {
      if (!result.success) {
        throw result.error;
      }

      const { config } = result;
      this.applyPackageSources(config.configuration?.packageSources?.[0], sources);
      this.applyDisabledPackageSources(config.configuration?.disabledPackageSources?.[0], disabledSources);
      this.applyCredentials(config.configuration?.packageSourceCredentials?.[0], credentials);
    }

    return Array.from(sources.values())
      .filter((source) => !disabledSources.get(this.normalizeSourceName(source.name)))
      .map((source) => {
        const sourceCredentials = credentials.get(this.normalizeSourceName(source.name));
        const authorizationHeader = this.createAuthorizationHeader(sourceCredentials);
        this.logger(`Source "${source.name}" authentication: ${authorizationHeader ? 'configured' : 'not configured'}.`);
        return { ...source, authorizationHeader };
      });
  }

  private async getConfigPathsAsync(projectFilePath: string): Promise<string[]> {
    const paths: string[] = [];
    const userConfigRoot = this.environment['APPDATA'] || this.environment['HOME'] || os.homedir();
    const userNuGetFolder = this.environment['APPDATA']
      ? path.join(userConfigRoot, 'NuGet')
      : path.join(userConfigRoot, '.nuget', 'NuGet');

    const userConfigPath = await this.findFileAsync(userNuGetFolder, 'NuGet.Config');
    if (userConfigPath) {
      paths.push(userConfigPath);
    }

    const additionalConfigFolder = path.join(userNuGetFolder, 'config');
    paths.push(...(await this.findConfigFilesAsync(additionalConfigFolder)));

    const projectFolder = path.dirname(projectFilePath);
    const ancestorFolders: string[] = [];
    let currentFolder = projectFolder;
    while (true) {
      ancestorFolders.unshift(currentFolder);
      const parentFolder = path.dirname(currentFolder);
      if (parentFolder === currentFolder) {
        break;
      }
      currentFolder = parentFolder;
    }

    const ancestorConfigPaths = await Promise.all(
      ancestorFolders.map((folder) => this.findFileAsync(folder, 'NuGet.Config'))
    );
    paths.push(...ancestorConfigPaths.filter((configPath): configPath is string => configPath !== undefined));
    return paths;
  }

  private async findConfigFilesAsync(folder: string): Promise<string[]> {
    try {
      const entries = await this.fileSystem.readdir(folder, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.config'))
        .map((entry) => path.join(folder, entry.name))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      return [];
    }
  }

  private async findFileAsync(folder: string, fileName: string): Promise<string | undefined> {
    try {
      const entries = await this.fileSystem.readdir(folder, { withFileTypes: true });
      const entry = entries.find((candidate) => candidate.isFile() && candidate.name.toLowerCase() === fileName.toLowerCase());
      return entry ? path.join(folder, entry.name) : undefined;
    } catch {
      return undefined;
    }
  }

  private applyPackageSources(
    section: { add?: Array<XmlEntry>; clear?: unknown[]; remove?: Array<XmlEntry> } | undefined,
    sources: Map<string, PackageSource>
  ): void {
    if (!section) {
      return;
    }

    if (section.clear) {
      sources.clear();
    }

    for (const entry of section.remove || []) {
      const key = entry.$?.key;
      if (key) {
        sources.delete(key);
      }
    }

    for (const entry of section.add || []) {
      const key = entry.$?.key;
      const value = entry.$?.value;
      if (key && value) {
        sources.set(key, { name: key, url: value, authorizationHeader: undefined });
      }
    }
  }

  private applyDisabledPackageSources(
    section: { add?: Array<XmlEntry>; clear?: unknown[]; remove?: Array<XmlEntry> } | undefined,
    disabledSources: Map<string, boolean>
  ): void {
    if (!section) {
      return;
    }

    if (section.clear) {
      disabledSources.clear();
    }

    for (const entry of section.remove || []) {
      const key = entry.$?.key;
      if (key) {
        disabledSources.delete(this.normalizeSourceName(key));
      }
    }

    for (const entry of section.add || []) {
      const key = entry.$?.key;
      const value = entry.$?.value?.trim().toLowerCase();
      if (key && (value === 'true' || value === 'false')) {
        disabledSources.set(this.normalizeSourceName(key), value === 'true');
      }
    }
  }

  private applyCredentials(
    sections: Record<string, Array<{ add?: Array<XmlEntry> }>> | undefined,
    credentials: Map<string, SourceCredentials>
  ): void {
    if (!sections) {
      return;
    }

    for (const [sourceName, entries] of Object.entries(sections)) {
      const sourceCredentials: SourceCredentials = {};
      for (const entry of entries[0]?.add || []) {
        const key = entry.$?.key?.toLowerCase();
        if (key === 'username') {
          sourceCredentials.username = this.expandEnvironmentVariables(entry.$?.value);
        } else if (key === 'cleartextpassword') {
          sourceCredentials.clearTextPassword = this.expandEnvironmentVariables(entry.$?.value);
        } else if (key === 'password') {
          this.logger(`Ignoring encrypted Password for source "${sourceName}"; only ClearTextPassword is supported.`);
        }
      }
      credentials.set(this.normalizeSourceName(sourceName), sourceCredentials);
    }
  }

  private expandEnvironmentVariables(value: string | undefined): string | undefined {
    return value?.replace(/%([^%]+)%/g, (variable, name: string) => this.environment[name] ?? variable);
  }

  private normalizeSourceName(sourceName: string): string {
    return sourceName.replace(/_x([0-9a-f]{4})_/gi, (_, codePoint: string) => String.fromCodePoint(Number.parseInt(codePoint, 16))).toLowerCase();
  }

  private createAuthorizationHeader(credentials: SourceCredentials | undefined): string | undefined {
    if (!credentials?.username || credentials.clearTextPassword === undefined) {
      return undefined;
    }

    const encodedCredentials = Buffer.from(`${credentials.username}:${credentials.clearTextPassword}`, 'utf8').toString('base64');
    return `Basic ${encodedCredentials}`;
  }

}

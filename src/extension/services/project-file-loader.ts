import * as fs from 'node:fs';
import * as xml2js from 'xml2js';
import * as path from 'node:path';
import { InstalledPackage, Project } from '../../shared/models/project';
import { formatErrorMessage } from '../../shared/utils/error-message';
import { NuGetDataParsingError } from '../../shared/utils/nuget-data-parsing-error';
import { localize } from './localization';

interface PackageReferenceXml {
  $?: {
    Include?: string;
    Version?: string;
    VersionOverride?: string;
  };
  Version?: string[];
  VersionOverride?: string[];
}

interface ItemGroupXml {
  PackageReference?: PackageReferenceXml[];
  PackageVersion?: PackageReferenceXml[];
}

interface ProjectFileXml {
  Project?: {
    ItemGroup?: ItemGroupXml[];
  };
}

export default class ProjectFileLoader {
  public async loadProjectAsync(projectFilePath: string): Promise<Project> {
    const projectContent = fs.readFileSync(projectFilePath, 'utf8');
    const packages = await this.readPackagesAsync(projectContent, path.dirname(projectFilePath));

    const projectName = path.basename(projectFilePath);

    return {
      name: projectName,
      fsPath: projectFilePath,
      packages: packages,
    };
  }

  private async readPackagesAsync(projectContent: string, projectFolder: string): Promise<InstalledPackage[]> {
    let parsedXml: ProjectFileXml;
    try {
      parsedXml = (await xml2js.parseStringPromise(projectContent)) as ProjectFileXml;
    } catch (error) {
      throw new NuGetDataParsingError(localize('error.invalidProjectXml', formatErrorMessage(error)));
    }

    const itemGroups = parsedXml.Project?.ItemGroup ?? [];
    const packageReferenceGroups = itemGroups.filter((itemGroup) => itemGroup.PackageReference !== undefined);
    const packageReferences = packageReferenceGroups.flatMap((itemGroup) => itemGroup.PackageReference ?? []);
    const centralVersions = await this.readCentralPackageVersionsAsync(projectFolder);

    return packageReferences.flatMap((packageReference) => {
      const id = packageReference.$?.Include;
      if (!id) {
        return [];
      }

      const version =
        packageReference.$?.VersionOverride ??
        packageReference.VersionOverride?.[0] ??
        packageReference.$?.Version ??
        packageReference.Version?.[0] ??
        centralVersions.get(id.toLowerCase());

      return version ? [{ id, version }] : [];
    });
  }

  private async readCentralPackageVersionsAsync(projectFolder: string): Promise<Map<string, string>> {
    const versions = new Map<string, string>();
    let currentFolder = projectFolder;

    while (true) {
      await this.addCentralPackageVersionsFromFileAsync(path.join(currentFolder, 'Directory.Packages.props'), versions);
      const parentFolder = path.dirname(currentFolder);
      if (parentFolder === currentFolder) {
        break;
      }
      currentFolder = parentFolder;
    }

    return versions;
  }

  private async addCentralPackageVersionsFromFileAsync(propsPath: string, versions: Map<string, string>): Promise<void> {
    if (!fs.existsSync(propsPath)) {
      return;
    }

    let parsedXml: ProjectFileXml;
    try {
      parsedXml = (await xml2js.parseStringPromise(fs.readFileSync(propsPath, 'utf8'))) as ProjectFileXml;
    } catch (error) {
      throw new NuGetDataParsingError(localize('error.invalidCentralPackagesXml', formatErrorMessage(error)));
    }

    const groups = parsedXml.Project?.ItemGroup ?? [];
    for (const packageVersion of groups.flatMap((group) => group.PackageVersion ?? [])) {
      const id = packageVersion.$?.Include;
      const version = packageVersion.$?.Version ?? packageVersion.Version?.[0];
      if (id && version && !versions.has(id.toLowerCase())) {
        versions.set(id.toLowerCase(), version);
      }
    }
  }
}

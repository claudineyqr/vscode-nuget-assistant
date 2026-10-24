import * as fs from 'node:fs';
import * as xml2js from 'xml2js';
import * as path from 'node:path';
import { InstalledPackage, Project } from '../../shared/models/project';

interface PackageReferenceXml {
  $: {
    Include: string;
    Version: string;
  };
}

interface ItemGroupXml {
  PackageReference?: PackageReferenceXml[];
}

interface ProjectFileXml {
  Project?: {
    ItemGroup?: ItemGroupXml[];
  };
}

export default class ProjectFileLoader {
  public async loadProjectAsync(projectFilePath: string): Promise<Project> {
    const projectContent = fs.readFileSync(projectFilePath, 'utf8');
    const packages = await this.readPackagesAsync(projectContent);

    const projectName = path.basename(projectFilePath);

    return {
      name: projectName,
      fsPath: projectFilePath,
      packages: packages,
    };
  }

  private async readPackagesAsync(projectContent: string): Promise<InstalledPackage[]> {
    const parsedXml = (await xml2js.parseStringPromise(projectContent)) as ProjectFileXml;

    const itemGroups = parsedXml.Project?.ItemGroup ?? [];
    const packageReferenceGroups = itemGroups.filter((itemGroup) => itemGroup.PackageReference !== undefined);
    const packageReferences = packageReferenceGroups.flatMap((itemGroup) => itemGroup.PackageReference ?? []);

    return packageReferences.map((packageReference) => ({
      id: packageReference.$.Include,
      version: packageReference.$.Version,
    }));
  }
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectSet } from '../../shared/models/project';
import ProjectFileLoader from './project-file-loader';

type FileSystem = {
  readFileSync(filePath: string, encoding: 'utf8'): string;
};

export default class SolutionLoader {
  public constructor(
    private readonly projectFileLoader: ProjectFileLoader = new ProjectFileLoader(),
    private readonly fileSystem: FileSystem = fs
  ) {}

  public async loadAsync(solutionFilePath: string): Promise<ProjectSet> {
    const projectPaths = this.readProjectPaths(solutionFilePath);
    const projects = await Promise.all(projectPaths.map((projectPath) => this.projectFileLoader.loadProjectAsync(projectPath)));

    return {
      name: path.basename(solutionFilePath),
      fsPath: solutionFilePath,
      projects,
    };
  }

  public readProjectPaths(solutionFilePath: string): string[] {
    const solutionContent = this.fileSystem.readFileSync(solutionFilePath, 'utf8');
    const solutionFolder = path.dirname(solutionFilePath);
    const projectPaths = path.extname(solutionFilePath).toLowerCase() === '.slnx'
      ? this.readSlnxProjectPaths(solutionContent)
      : this.readSlnProjectPaths(solutionContent);

    return Array.from(
      new Set(
        projectPaths.map((projectPath) =>
          path.normalize(path.resolve(solutionFolder, projectPath.replace(/[\\/]/g, path.sep)))
        )
      )
    ).sort((left, right) => left.localeCompare(right));
  }

  private readSlnProjectPaths(solutionContent: string): string[] {
    const projectPaths: string[] = [];
    const projectPattern = /^Project\(".*"\)\s*=\s*".*",\s*"([^"]+\.(?:csproj|vbproj|fsproj))",/gim;
    let match: RegExpExecArray | null;

    while ((match = projectPattern.exec(solutionContent)) !== null) {
      projectPaths.push(match[1]);
    }

    return projectPaths;
  }

  private readSlnxProjectPaths(solutionContent: string): string[] {
    const projectPaths: string[] = [];
    const projectPattern = /(?:Path|path)\s*=\s*["']([^"']+\.(?:csproj|vbproj|fsproj))["']/g;
    let match: RegExpExecArray | null;

    while ((match = projectPattern.exec(solutionContent)) !== null) {
      projectPaths.push(match[1]);
    }

    return projectPaths;
  }
}

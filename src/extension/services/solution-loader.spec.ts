import * as path from 'path';
import ProjectFileLoader from './project-file-loader';
import SolutionLoader from './solution-loader';

describe('SolutionLoader', () => {
  it('loads project files into a solution model after resolving their paths', async () => {
    const solutionPath = path.join('workspace', 'sample.sln');
    const projectContent = [
      'Project("{GUID}") = "Library", "src\\Library\\Library.csproj", "{LIB}"',
      'Project("{GUID}") = "App", "src\\App\\App.csproj", "{APP}"',
    ].join('\n');
    const loadedProjects = new Map([
      [path.normalize(path.resolve('workspace', 'src', 'App', 'App.csproj')), { name: 'App.csproj', fsPath: 'app', packages: [] }],
      [path.normalize(path.resolve('workspace', 'src', 'Library', 'Library.csproj')), { name: 'Library.csproj', fsPath: 'library', packages: [] }],
    ]);
    const projectFileLoader = {
      loadProjectAsync: jest.fn((filePath: string) => Promise.resolve(loadedProjects.get(filePath)!)),
    };
    const loader = new SolutionLoader(projectFileLoader as unknown as ProjectFileLoader, {
      readFileSync: () => projectContent,
    });

    const result = await loader.loadAsync(solutionPath);

    expect(result).toEqual({
      name: 'sample.sln',
      fsPath: solutionPath,
      projects: [loadedProjects.get(path.normalize(path.resolve('workspace', 'src', 'App', 'App.csproj'))),
        loadedProjects.get(path.normalize(path.resolve('workspace', 'src', 'Library', 'Library.csproj')))],
    });
    expect(projectFileLoader.loadProjectAsync).toHaveBeenCalledTimes(2);
  });

  it('should resolve and deduplicate project paths from a sln file', () => {
    const solutionPath = path.join('workspace', 'sample.sln');
    const solutionContent = [
      'Project("{GUID}") = "App", "src\\App\\App.csproj", "{APP}"',
      'Project("{GUID}") = "App Duplicate", "src\\App\\App.csproj", "{APP2}"',
      'Project("{GUID}") = "Library", "src\\Library\\Library.csproj", "{LIB}"',
    ].join('\n');
    const loader = new SolutionLoader({} as ProjectFileLoader, { readFileSync: () => solutionContent });

    expect(loader.readProjectPaths(solutionPath)).toEqual([
      path.normalize(path.resolve('workspace', 'src', 'App', 'App.csproj')),
      path.normalize(path.resolve('workspace', 'src', 'Library', 'Library.csproj')),
    ]);
  });

  it('should resolve project paths from a slnx file', () => {
    const solutionPath = path.join('workspace', 'sample.slnx');
    const loader = new SolutionLoader({} as ProjectFileLoader, {
      readFileSync: () => '<Solution><Project Path="src/App/App.csproj" /><Project Path="src/Lib/Lib.fsproj" /></Solution>',
    });

    expect(loader.readProjectPaths(solutionPath)).toEqual([
      path.normalize(path.resolve('workspace', 'src', 'App', 'App.csproj')),
      path.normalize(path.resolve('workspace', 'src', 'Lib', 'Lib.fsproj')),
    ]);
  });
});
